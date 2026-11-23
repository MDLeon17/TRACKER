package main

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schema string

type app struct {
	db     *sql.DB
	web    string
	limits limiter
}

type member struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Theme string `json:"theme"`
}

type problem struct {
	status  int
	message string
}

func (p problem) Error() string { return p.message }
func invalid(s string) error    { return problem{400, s} }
func conflict(s string) error   { return problem{409, s} }
func forbidden(s string) error  { return problem{403, s} }
func missing(s string) error    { return problem{404, s} }
func now() string               { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }
func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func openApp(path, web string) (*app, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return &app{db: db, web: web}, nil
}

func reply(w http.ResponseWriter, status int, v any) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(v)
}
func decode(w http.ResponseWriter, r *http.Request, out any) error {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 192<<10))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return invalid("Revisa los datos del formulario.")
	}
	if d.Decode(new(any)) != io.EOF {
		return invalid("Envía un solo formulario por solicitud.")
	}
	return nil
}
func (a *app) change(ctx context.Context, f func(*sql.Tx) error) error {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = f(tx); err != nil {
		return err
	}
	if _, err = tx.Exec("UPDATE workspace_version SET revision=revision+1 WHERE id=1"); err != nil {
		return err
	}
	return tx.Commit()
}

type endpoint func(http.ResponseWriter, *http.Request, *member) error

func (a *app) router() http.Handler {
	mux := http.NewServeMux()
	route := func(pattern string, private bool, h endpoint) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "private, no-store")
			var err error
			var me *member
			if r.Method == "POST" {
				media, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
				if media != "application/json" {
					err = problem{415, "Envía los datos como JSON."}
				}
				if origin := r.Header.Get("Origin"); origin != "" {
					u, e := url.Parse(origin)
					if e != nil || !strings.EqualFold(u.Host, r.Host) {
						err = forbidden("El origen de la solicitud es inválido.")
					}
				}
				if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
					err = forbidden("El origen de la solicitud es inválido.")
				}
			}
			if err == nil && private {
				me, err = a.authenticated(r)
				if me == nil && err == nil {
					err = problem{401, "Inicia sesión para continuar."}
				}
			}
			if err == nil {
				err = h(w, r, me)
			}
			if err != nil {
				var p problem
				if !errors.As(err, &p) {
					log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
					p = problem{500, "No se pudo guardar o cargar la información. Inténtalo de nuevo."}
				}
				_ = reply(w, p.status, map[string]string{"error": p.message})
			}
		})
	}
	route("GET /api/session", false, a.sessionInfo)
	route("POST /api/register", false, a.register)
	route("POST /api/login", false, a.login)
	route("POST /api/logout", true, a.logout)
	route("GET /api/workspace", true, a.workspace)
	route("GET /api/events", true, a.olderEvents)
	route("POST /api/notifications/read", true, a.markRead)
	route("POST /api/theme", true, a.setTheme)
	route("POST /api/projects", true, a.createProject)
	route("POST /api/projects/{id}/tasks", true, a.addTask)
	route("POST /api/tasks/{id}/respond", true, a.respond)
	route("POST /api/tasks/{id}/complete", true, a.complete)
	route("POST /api/tasks/{id}/assign", true, a.assign)
	mux.HandleFunc("GET /api/", func(w http.ResponseWriter, r *http.Request) {
		_ = reply(w, 404, map[string]string{"error": "Ruta desconocida."})
	})
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := a.db.PingContext(r.Context()); err != nil {
			http.Error(w, "unavailable", 503)
			return
		}
		_ = reply(w, 200, map[string]string{"status": "ok"})
	})
	files := http.FileServer(http.Dir(a.web))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && !strings.HasPrefix(r.URL.Path, "/assets/") && r.URL.Path != "/favicon.svg" {
			http.NotFound(w, r)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			if strings.HasSuffix(r.URL.Path, "/") {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		mux.ServeHTTP(w, r)
	})
}

func main() {
	a, err := openApp(env("DB_PATH", "data/relevo.sqlite"), env("WEB_DIR", "../web/dist"))
	if err != nil {
		log.Fatal(err)
	}
	defer a.db.Close()
	srv := &http.Server{Addr: env("ADDR", ":8080"), Handler: a.router(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 75 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	fmt.Printf("Relevo escuchando en %s\n", srv.Addr)
	if err = srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
