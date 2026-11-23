package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"

	"golang.org/x/crypto/bcrypt"
)

type newTask struct {
	Name     string   `json:"name"`
	Priority string   `json:"priority"`
	People   []string `json:"people"`
}

func routeID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, invalid("El identificador es inválido.")
	}
	return id, nil
}
func addEvent(tx *sql.Tx, kind, actor string, project, task any, message string) error {
	_, err := tx.Exec("INSERT INTO events(kind,actor,project_id,task_id,message,at) VALUES(?,?,?,?,?,?)", kind, actor, project, task, message, now())
	return err
}
func repoURL(raw string) (string, error) {
	bad := invalid("Ingresa el enlace HTTPS del repositorio de GitHub o GitLab, incluido el grupo y el proyecto.")
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(raw) > 512 {
		return "", bad
	}
	host := strings.ToLower(u.Host)
	if host != "github.com" && host != "gitlab.com" {
		return "", bad
	}
	u.Host = host
	u.Path = strings.TrimSuffix(u.Path, "/")
	parts := strings.Split(strings.TrimPrefix(u.Path, "/"), "/")
	if len(parts) < 2 || (host == "github.com" && len(parts) != 2) {
		return "", bad
	}
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || part == "-" {
			return "", bad
		}
		for _, c := range part {
			if !unicode.IsLetter(c) && !unicode.IsDigit(c) && !strings.ContainsRune("-_.", c) {
				return "", bad
			}
		}
	}
	u.RawPath = ""
	return u.String(), nil
}
func invite(tx *sql.Tx, ids []string, me *member, task int64) ([]string, error) {
	if len(ids) == 0 || len(ids) > 32 {
		return nil, invalid("Selecciona entre 1 y 32 personas registradas.")
	}
	names := make([]string, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			return nil, invalid("Cada responsable debe aparecer una sola vez.")
		}
		seen[id] = true
		var name string
		err := tx.QueryRow("SELECT name FROM users WHERE id=?", id).Scan(&name)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, invalid("Solo puedes asignar objetivos a personas registradas.")
		}
		if err != nil {
			return nil, err
		}
		state := "invited"
		if id == me.ID {
			state = "accepted"
		}
		result, err := tx.Exec(`INSERT INTO assignments(task_id,user_id,state) VALUES(?,?,?)
		ON CONFLICT(task_id,user_id) DO UPDATE SET state=excluded.state,completed_at=''
		WHERE assignments.state='declined'`, task, id, state)
		if err != nil {
			return nil, err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return nil, err
		}
		if n == 0 {
			return nil, conflict("Esta persona ya participa en el objetivo.")
		}
		names = append(names, name)
	}
	return names, nil
}
func makeTask(tx *sql.Tx, project int64, in newTask, me *member) error {
	name := cleanName(in.Name, 1, 180)
	if name == "" {
		return invalid("Cada objetivo necesita un nombre de hasta 180 caracteres.")
	}
	if in.Priority != "alta" && in.Priority != "media" && in.Priority != "baja" {
		return invalid("Selecciona la urgencia de cada objetivo.")
	}
	res, err := tx.Exec("INSERT INTO tasks(project_id,name,priority,creator,created_at) VALUES(?,?,?,?,?)", project, name, in.Priority, me.ID, now())
	if err != nil {
		return err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return err
	}
	names, err := invite(tx, in.People, me, id)
	if err != nil {
		return err
	}
	return addEvent(tx, "assigned", me.ID, project, id, fmt.Sprintf("%s asignó «%s» a %s.", me.Name, name, strings.Join(names, ", ")))
}

// The key survives a form retry if the transaction committed but the response was lost.
func (a *app) createOnce(r *http.Request, me *member, payload any, project *int64, create func(*sql.Tx) error) error {
	key := r.Header.Get("Idempotency-Key")
	if key == "" {
		return a.change(r.Context(), create)
	}
	if len(key) < 16 || len(key) > 80 {
		return invalid("El identificador de la solicitud es inválido.")
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	hash := digest(r.URL.Path + "|" + string(data))
	return a.change(r.Context(), func(tx *sql.Tx) error {
		var priorHash string
		var priorProject int64
		err := tx.QueryRow("SELECT payload_hash,project_id FROM creation_requests WHERE actor=? AND request_key=?", me.ID, key).Scan(&priorHash, &priorProject)
		switch {
		case err == nil:
			if priorHash != hash {
				return conflict("La versión anterior ya se guardó. Cierra el formulario y revisa el proyecto.")
			}
			*project = priorProject
			return nil
		case !errors.Is(err, sql.ErrNoRows):
			return err
		}
		if err = create(tx); err != nil {
			return err
		}
		_, err = tx.Exec("INSERT INTO creation_requests(actor,request_key,payload_hash,project_id) VALUES(?,?,?,?)", me.ID, key, hash, *project)
		return err
	})
}

func (a *app) createProject(w http.ResponseWriter, r *http.Request, me *member) error {
	var in struct {
		Name  string    `json:"name"`
		Due   string    `json:"due"`
		Repo  string    `json:"repo"`
		Tasks []newTask `json:"tasks"`
	}
	if err := decode(w, r, &in); err != nil {
		return err
	}
	name := cleanName(in.Name, 1, 100)
	if name == "" {
		return invalid("Escribe un nombre de proyecto de hasta 100 caracteres.")
	}
	date, err := time.Parse("2006-01-02", in.Due)
	if err != nil || date.Year() < 1 || date.Format("2006-01-02") != in.Due {
		return invalid("Selecciona una fecha de entrega válida.")
	}
	repo, err := repoURL(in.Repo)
	if err != nil {
		return err
	}
	if len(in.Tasks) == 0 || len(in.Tasks) > 50 {
		return invalid("Agrega entre 1 y 50 objetivos al proyecto.")
	}
	var id int64
	err = a.createOnce(r, me, in, &id, func(tx *sql.Tx) error {
		result, err := tx.Exec("INSERT INTO projects(name,due,repo,creator,created_at) VALUES(?,?,?,?,?)", name, in.Due, repo, me.ID, now())
		if err != nil {
			return err
		}
		id, err = result.LastInsertId()
		if err != nil {
			return err
		}
		if err = addEvent(tx, "project", me.ID, id, nil, me.Name+" creó el proyecto «"+name+"»."); err != nil {
			return err
		}
		for _, t := range in.Tasks {
			if err = makeTask(tx, id, t, me); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return reply(w, 201, map[string]int64{"id": id})
}
func (a *app) addTask(w http.ResponseWriter, r *http.Request, me *member) error {
	id, err := routeID(r)
	if err != nil {
		return err
	}
	var in newTask
	if err = decode(w, r, &in); err != nil {
		return err
	}
	err = a.createOnce(r, me, in, &id, func(tx *sql.Tx) error {
		var closed string
		err := tx.QueryRow("SELECT completed_at FROM projects WHERE id=?", id).Scan(&closed)
		if errors.Is(err, sql.ErrNoRows) {
			return missing("Proyecto desconocido.")
		}
		if err != nil {
			return err
		}
		if closed != "" {
			return conflict("Este proyecto ya está en el historial.")
		}
		return makeTask(tx, id, in, me)
	})
	if err != nil {
		return err
	}
	return reply(w, 201, map[string]bool{"ok": true})
}

type taskInfo struct {
	project      int64
	name, closed string
}

func findTask(tx *sql.Tx, id int64) (taskInfo, error) {
	var t taskInfo
	err := tx.QueryRow("SELECT project_id,name,completed_at FROM tasks WHERE id=?", id).Scan(&t.project, &t.name, &t.closed)
	if errors.Is(err, sql.ErrNoRows) {
		return t, missing("Objetivo desconocido.")
	}
	return t, err
}
func ownState(tx *sql.Tx, id int64, me string) (string, error) {
	var state string
	err := tx.QueryRow("SELECT state FROM assignments WHERE task_id=? AND user_id=?", id, me).Scan(&state)
	if errors.Is(err, sql.ErrNoRows) {
		return "", forbidden("Este objetivo pertenece a otra persona.")
	}
	return state, err
}
func finishIfReady(tx *sql.Tx, t taskInfo, id int64, actor string) error {
	at := now()
	result, err := tx.Exec(`UPDATE tasks SET completed_at=? WHERE id=? AND completed_at=''
	AND EXISTS(SELECT 1 FROM assignments WHERE task_id=? AND state='done')
	AND NOT EXISTS(SELECT 1 FROM assignments WHERE task_id=? AND state IN ('invited','accepted'))`, at, id, id, id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil || count == 0 {
		return err
	}
	if err = addEvent(tx, "task_done", actor, t.project, id, "Se completó el objetivo «"+t.name+"»."); err != nil {
		return err
	}
	result, err = tx.Exec(`UPDATE projects SET completed_at=? WHERE id=? AND completed_at=''
	AND NOT EXISTS(SELECT 1 FROM tasks WHERE project_id=? AND completed_at='')`, at, t.project, t.project)
	if err != nil {
		return err
	}
	count, err = result.RowsAffected()
	if err != nil || count == 0 {
		return err
	}
	var name string
	if err = tx.QueryRow("SELECT name FROM projects WHERE id=?", t.project).Scan(&name); err != nil {
		return err
	}
	return addEvent(tx, "project_done", actor, t.project, nil, "El proyecto «"+name+"» pasó al historial.")
}
func (a *app) respond(w http.ResponseWriter, r *http.Request, me *member) error {
	id, err := routeID(r)
	if err != nil {
		return err
	}
	var in struct {
		Decision string `json:"decision"`
	}
	if err = decode(w, r, &in); err != nil {
		return err
	}
	if in.Decision != "accepted" && in.Decision != "declined" {
		return invalid("Elige aceptar o rechazar.")
	}
	err = a.change(r.Context(), func(tx *sql.Tx) error {
		t, err := findTask(tx, id)
		if err != nil {
			return err
		}
		state, err := ownState(tx, id, me.ID)
		if err != nil {
			return err
		}
		if state == in.Decision {
			return nil
		}
		if state != "invited" || t.closed != "" {
			return conflict("Esta solicitud ya tiene respuesta.")
		}
		if _, err = tx.Exec("UPDATE assignments SET state=? WHERE task_id=? AND user_id=?", in.Decision, id, me.ID); err != nil {
			return err
		}
		verb := " aceptó "
		if in.Decision == "declined" {
			verb = " rechazó "
		}
		if err = addEvent(tx, in.Decision, me.ID, t.project, id, me.Name+verb+"el objetivo «"+t.name+"»."); err != nil {
			return err
		}
		return finishIfReady(tx, t, id, me.ID)
	})
	if err != nil {
		return err
	}
	return reply(w, 200, map[string]bool{"ok": true})
}
func (a *app) complete(w http.ResponseWriter, r *http.Request, me *member) error {
	id, err := routeID(r)
	if err != nil {
		return err
	}
	var in struct {
		Password string `json:"password"`
	}
	if err = decode(w, r, &in); err != nil {
		return err
	}
	var hash []byte
	var state string
	err = a.db.QueryRowContext(r.Context(), "SELECT u.password_hash,s.state FROM assignments s JOIN users u ON u.id=s.user_id WHERE s.task_id=? AND s.user_id=?", id, me.ID).Scan(&hash, &state)
	if errors.Is(err, sql.ErrNoRows) {
		return forbidden("Solo un responsable puede confirmar su propio trabajo.")
	}
	if err != nil {
		return err
	}
	if state != "accepted" && state != "done" {
		return conflict("Acepta la asignación antes de completarla.")
	}
	if err = a.limits.check("confirm:"+me.ID, 60); err != nil {
		return err
	}
	if len(in.Password) > 72 || bcrypt.CompareHashAndPassword(hash, []byte(in.Password)) != nil {
		return forbidden("La contraseña es incorrecta.")
	}
	err = a.change(r.Context(), func(tx *sql.Tx) error {
		t, err := findTask(tx, id)
		if err != nil {
			return err
		}
		s, err := ownState(tx, id, me.ID)
		if err != nil {
			return err
		}
		if s == "done" {
			return nil
		}
		if s != "accepted" || t.closed != "" {
			return conflict("El objetivo ya cambió de estado.")
		}
		if _, err = tx.Exec("UPDATE assignments SET state='done',completed_at=? WHERE task_id=? AND user_id=?", now(), id, me.ID); err != nil {
			return err
		}
		if err = addEvent(tx, "confirmed", me.ID, t.project, id, me.Name+" confirmó su trabajo en «"+t.name+"»."); err != nil {
			return err
		}
		return finishIfReady(tx, t, id, me.ID)
	})
	if err != nil {
		return err
	}
	return reply(w, 200, map[string]bool{"ok": true})
}
func (a *app) assign(w http.ResponseWriter, r *http.Request, me *member) error {
	id, err := routeID(r)
	if err != nil {
		return err
	}
	var in struct {
		People []string `json:"people"`
	}
	if err = decode(w, r, &in); err != nil {
		return err
	}
	err = a.change(r.Context(), func(tx *sql.Tx) error {
		t, err := findTask(tx, id)
		if err != nil {
			return err
		}
		var occupied bool
		if err = tx.QueryRow("SELECT EXISTS(SELECT 1 FROM assignments WHERE task_id=? AND state!='declined')", id).Scan(&occupied); err != nil {
			return err
		}
		if t.closed != "" || occupied {
			return conflict("Solo puedes reasignar un objetivo que quedó sin responsable.")
		}
		names, err := invite(tx, in.People, me, id)
		if err != nil {
			return err
		}
		return addEvent(tx, "assigned", me.ID, t.project, id, fmt.Sprintf("%s reasignó «%s» a %s.", me.Name, t.name, strings.Join(names, ", ")))
	})
	if err != nil {
		return err
	}
	return reply(w, 200, map[string]bool{"ok": true})
}
