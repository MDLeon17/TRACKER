package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

const sessionDays = 30
const passwordCost = 11

var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("unavailable-account"), passwordCost)

type bucket struct {
	count int
	until time.Time
}
type limiter struct {
	mu    sync.Mutex
	slots map[string]bucket
	swept time.Time
}

func (l *limiter) check(key string, max int) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	t := time.Now()
	if l.slots == nil {
		l.slots = make(map[string]bucket)
	}
	if t.Sub(l.swept) > time.Minute {
		for k, v := range l.slots {
			if !t.Before(v.until) {
				delete(l.slots, k)
			}
		}
		l.swept = t
	}
	b := l.slots[key]
	if !t.Before(b.until) {
		b = bucket{until: t.Add(5 * time.Minute)}
	}
	if b.count >= max {
		return problem{429, "Hay demasiados intentos. Vuelve a intentarlo en cinco minutos."}
	}
	b.count++
	l.slots[key] = b
	return nil
}

func clientIP(r *http.Request) string {
	if ip := net.ParseIP(r.Header.Get("CF-Connecting-IP")); ip != nil {
		return ip.String()
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	return host
}
func randomToken() string {
	var b [32]byte
	rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
func digest(s string) string { b := sha256.Sum256([]byte(s)); return hex.EncodeToString(b[:]) }
func cookieHash(r *http.Request, name string) string {
	c, err := r.Cookie(name)
	if err != nil || len(c.Value) != 64 {
		return ""
	}
	if _, err = hex.DecodeString(c.Value); err != nil {
		return ""
	}
	return digest(c.Value)
}
func cookie(w http.ResponseWriter, r *http.Request, name, value string, age int) {
	secure := r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", MaxAge: age, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure})
}
func sessionToken(tx *sql.Tx, device string) (string, error) {
	token := randomToken()
	if _, err := tx.Exec("DELETE FROM sessions WHERE device_id=? OR expires<=?", device, time.Now().Unix()); err != nil {
		return "", err
	}
	_, err := tx.Exec("INSERT INTO sessions(token_hash,device_id,expires) VALUES(?,?,?)", digest(token), device, time.Now().Add(sessionDays*24*time.Hour).Unix())
	return token, err
}
func (a *app) authenticated(r *http.Request) (*member, error) {
	s, d := cookieHash(r, "relevo_session"), cookieHash(r, "relevo_device")
	if s == "" || d == "" {
		return nil, nil
	}
	var m member
	err := a.db.QueryRowContext(r.Context(), `SELECT u.id,u.name,u.theme FROM sessions s
	JOIN devices d ON d.id=s.device_id JOIN users u ON u.id=d.user_id
	WHERE s.token_hash=? AND d.id=? AND s.expires>?`, s, d, time.Now().Unix()).Scan(&m.ID, &m.Name, &m.Theme)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &m, err
}
func (a *app) sessionInfo(w http.ResponseWriter, r *http.Request, _ *member) error {
	dev := cookieHash(r, "relevo_device")
	if dev == "" {
		raw := randomToken()
		cookie(w, r, "relevo_device", raw, 400*24*3600)
		dev = digest(raw)
	}
	var linked string
	err := a.db.QueryRowContext(r.Context(), "SELECT u.name FROM users u JOIN devices d ON d.user_id=u.id WHERE d.id=?", dev).Scan(&linked)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	me, err := a.authenticated(r)
	if err != nil {
		return err
	}
	return reply(w, 200, map[string]any{"me": me, "linkedName": linked, "deviceCode": strings.ToUpper(dev[:10])})
}
func cleanName(s string, min, max int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) < min || utf8.RuneCountInString(s) > max || strings.IndexFunc(s, unicode.IsControl) >= 0 {
		return ""
	}
	return s
}
func validTheme(t string) bool { return t == "papel" || t == "grafito" || t == "oceano" }

type credentials struct {
	Name     string `json:"name"`
	Password string `json:"password"`
	Theme    string `json:"theme"`
}

func (a *app) register(w http.ResponseWriter, r *http.Request, _ *member) error {
	if err := a.limits.check("register:"+clientIP(r), 25); err != nil {
		return err
	}
	var in credentials
	if err := decode(w, r, &in); err != nil {
		return err
	}
	dev := cookieHash(r, "relevo_device")
	if dev == "" {
		return conflict("Activa las cookies y recarga la página para registrar este navegador.")
	}
	name := cleanName(in.Name, 2, 64)
	if name == "" || strings.HasPrefix(strings.ToUpper(name), "RV-") {
		return invalid("Usa un nombre de 2 a 64 caracteres que no comience con RV-.")
	}
	if utf8.RuneCountInString(in.Password) < 10 || len(in.Password) > 72 {
		return invalid("Usa al menos 10 caracteres y un máximo de 72 bytes en tu contraseña.")
	}
	if in.Theme == "" {
		in.Theme = "papel"
	}
	if !validTheme(in.Theme) {
		return invalid("Elige un tema disponible.")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), passwordCost)
	if err != nil {
		return err
	}
	m := member{ID: "RV-" + strings.ToUpper(dev[:24]), Name: name, Theme: in.Theme}
	var token string
	err = a.change(r.Context(), func(tx *sql.Tx) error {
		var exists bool
		if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM devices WHERE id=?)", dev).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return conflict("Este navegador ya tiene una cuenta vinculada. Inicia sesión.")
		}
		if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE name_key=?)", strings.ToLower(name)).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return conflict("Ese nombre ya está registrado. Usa otro o inicia sesión.")
		}
		_, err := tx.Exec(`INSERT INTO users(id,name,name_key,password_hash,theme,joined_at,read_through)
		VALUES(?,?,?,?,?,?,(SELECT COALESCE(MAX(id),0) FROM events))`, m.ID, name, strings.ToLower(name), hash, m.Theme, now())
		if err != nil {
			return err
		}
		if _, err = tx.Exec("INSERT INTO devices VALUES(?,?)", dev, m.ID); err != nil {
			return err
		}
		if err = addEvent(tx, "joined", m.ID, nil, nil, name+" se unió al equipo."); err != nil {
			return err
		}
		token, err = sessionToken(tx, dev)
		return err
	})
	if err != nil {
		return err
	}
	cookie(w, r, "relevo_session", token, sessionDays*24*3600)
	return reply(w, 201, m)
}

func (a *app) login(w http.ResponseWriter, r *http.Request, _ *member) error {
	if err := a.limits.check("login:"+clientIP(r), 40); err != nil {
		return err
	}
	var in credentials
	if err := decode(w, r, &in); err != nil {
		return err
	}
	dev := cookieHash(r, "relevo_device")
	if dev == "" {
		return conflict("Activa las cookies y recarga la página para iniciar sesión.")
	}
	var m member
	var hash []byte
	name := strings.TrimSpace(in.Name)
	err := a.db.QueryRowContext(r.Context(), "SELECT id,name,theme,password_hash FROM users WHERE name_key=? OR id=?", strings.ToLower(name), strings.ToUpper(name)).Scan(&m.ID, &m.Name, &m.Theme, &hash)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if m.ID == "" {
		hash = dummyHash
	}
	if bcrypt.CompareHashAndPassword(hash, []byte(in.Password)) != nil || m.ID == "" || len(in.Password) > 72 {
		return problem{401, "El nombre o la contraseña son incorrectos."}
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("INSERT OR IGNORE INTO devices VALUES(?,?)", dev, m.ID); err != nil {
		return err
	}
	var owner string
	if err = tx.QueryRow("SELECT user_id FROM devices WHERE id=?", dev).Scan(&owner); err != nil {
		return err
	}
	if owner != m.ID {
		return conflict("Este perfil del navegador está vinculado a otra cuenta. Usa tu propio perfil.")
	}
	token, err := sessionToken(tx, dev)
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	cookie(w, r, "relevo_session", token, sessionDays*24*3600)
	return reply(w, 200, m)
}
func (a *app) logout(w http.ResponseWriter, r *http.Request, _ *member) error {
	if _, err := a.db.ExecContext(r.Context(), "DELETE FROM sessions WHERE token_hash=?", cookieHash(r, "relevo_session")); err != nil {
		return err
	}
	cookie(w, r, "relevo_session", "", -1)
	return reply(w, 200, map[string]bool{"ok": true})
}
func (a *app) setTheme(w http.ResponseWriter, r *http.Request, me *member) error {
	var in struct {
		Theme string `json:"theme"`
	}
	if err := decode(w, r, &in); err != nil {
		return err
	}
	if !validTheme(in.Theme) {
		return invalid("Elige un tema disponible.")
	}
	err := a.change(r.Context(), func(tx *sql.Tx) error {
		_, err := tx.Exec("UPDATE users SET theme=? WHERE id=?", in.Theme, me.ID)
		return err
	})
	if err != nil {
		return err
	}
	return reply(w, 200, map[string]bool{"ok": true})
}
