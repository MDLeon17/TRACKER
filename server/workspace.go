package main

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
)

type person struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	JoinedAt string `json:"joinedAt"`
}
type assignment struct {
	User        string `json:"user"`
	State       string `json:"state"`
	CompletedAt string `json:"completedAt"`
}
type task struct {
	ID          int64        `json:"id"`
	ProjectID   int64        `json:"projectId"`
	Name        string       `json:"name"`
	Priority    string       `json:"priority"`
	CreatedAt   string       `json:"createdAt"`
	CompletedAt string       `json:"completedAt"`
	People      []assignment `json:"people"`
}
type project struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	Due         string  `json:"due"`
	Repo        string  `json:"repo"`
	CreatedAt   string  `json:"createdAt"`
	CompletedAt string  `json:"completedAt"`
	Tasks       []*task `json:"tasks"`
}
type event struct {
	ID        int64  `json:"id"`
	Kind      string `json:"kind"`
	Actor     string `json:"actor"`
	ProjectID int64  `json:"projectId"`
	TaskID    int64  `json:"taskId"`
	Message   string `json:"message"`
	At        string `json:"at"`
}
type eventPage struct {
	Events []event `json:"events"`
	More   bool    `json:"more"`
}
type snapshot struct {
	Me          member     `json:"me"`
	People      []person   `json:"people"`
	Projects    []*project `json:"projects"`
	Feed        eventPage  `json:"feed"`
	ReadThrough int64      `json:"readThrough"`
	Unread      int64      `json:"unread"`
}

func rows(tx *sql.Tx, query string, visit func(*sql.Rows) error, args ...any) error {
	rs, err := tx.Query(query, args...)
	if err != nil {
		return err
	}
	defer rs.Close()
	for rs.Next() {
		if err = visit(rs); err != nil {
			return err
		}
	}
	return rs.Err()
}
func pageEvents(tx *sql.Tx, before int64) (eventPage, error) {
	page := eventPage{Events: []event{}}
	const limit = 40
	err := rows(tx, `SELECT id,kind,actor,COALESCE(project_id,0),COALESCE(task_id,0),message,at
	FROM events WHERE id<? ORDER BY id DESC LIMIT ?`, func(rs *sql.Rows) error {
		var e event
		if err := rs.Scan(&e.ID, &e.Kind, &e.Actor, &e.ProjectID, &e.TaskID, &e.Message, &e.At); err != nil {
			return err
		}
		if len(page.Events) == limit {
			page.More = true
		} else {
			page.Events = append(page.Events, e)
		}
		return nil
	}, before, limit+1)
	return page, err
}

const latestEvent int64 = 1<<63 - 1

func (a *app) olderEvents(w http.ResponseWriter, r *http.Request, _ *member) error {
	before, err := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	if err != nil || before < 1 {
		return invalid("La página de actividad es inválida.")
	}
	tx, err := a.db.BeginTx(r.Context(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	page, err := pageEvents(tx, before)
	if err != nil {
		return err
	}
	return reply(w, 200, page)
}
func (a *app) markRead(w http.ResponseWriter, r *http.Request, me *member) error {
	var in struct {
		Through int64 `json:"through"`
	}
	if err := decode(w, r, &in); err != nil {
		return err
	}
	if in.Through <= 0 {
		return invalid("Elige una notificación válida.")
	}
	err := a.change(r.Context(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE users SET read_through=MAX(read_through,MIN(?,(SELECT COALESCE(MAX(id),0) FROM events))) WHERE id=?`, in.Through, me.ID)
		return err
	})
	if err != nil {
		return err
	}
	return reply(w, 200, map[string]bool{"ok": true})
}
func (a *app) workspace(w http.ResponseWriter, r *http.Request, me *member) error {
	tx, err := a.db.BeginTx(r.Context(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var rev int64
	if err = tx.QueryRow("SELECT revision FROM workspace_version WHERE id=1").Scan(&rev); err != nil {
		return err
	}
	tag := fmt.Sprintf(`"relevo-%s-%d"`, me.ID, rev)
	w.Header().Set("ETag", tag)
	if r.Header.Get("If-None-Match") == tag {
		w.WriteHeader(304)
		return nil
	}
	s := snapshot{People: []person{}, Projects: []*project{}, Me: *me}
	if err = tx.QueryRow("SELECT read_through,theme FROM users WHERE id=?", me.ID).Scan(&s.ReadThrough, &s.Me.Theme); err != nil {
		return err
	}
	if err = tx.QueryRow("SELECT COUNT(*) FROM events WHERE id>?", s.ReadThrough).Scan(&s.Unread); err != nil {
		return err
	}
	err = rows(tx, "SELECT id,name,joined_at FROM users ORDER BY name_key", func(rs *sql.Rows) error {
		var p person
		if err := rs.Scan(&p.ID, &p.Name, &p.JoinedAt); err != nil {
			return err
		}
		s.People = append(s.People, p)
		return nil
	})
	if err != nil {
		return err
	}
	projects := make(map[int64]*project)
	err = rows(tx, "SELECT id,name,due,repo,created_at,completed_at FROM projects ORDER BY id DESC", func(rs *sql.Rows) error {
		p := &project{Tasks: []*task{}}
		if err := rs.Scan(&p.ID, &p.Name, &p.Due, &p.Repo, &p.CreatedAt, &p.CompletedAt); err != nil {
			return err
		}
		projects[p.ID] = p
		s.Projects = append(s.Projects, p)
		return nil
	})
	if err != nil {
		return err
	}
	tasks := make(map[int64]*task)
	err = rows(tx, "SELECT id,project_id,name,priority,created_at,completed_at FROM tasks ORDER BY id", func(rs *sql.Rows) error {
		t := &task{People: []assignment{}}
		if err := rs.Scan(&t.ID, &t.ProjectID, &t.Name, &t.Priority, &t.CreatedAt, &t.CompletedAt); err != nil {
			return err
		}
		tasks[t.ID] = t
		p := projects[t.ProjectID]
		p.Tasks = append(p.Tasks, t)
		return nil
	})
	if err != nil {
		return err
	}
	err = rows(tx, "SELECT task_id,user_id,state,completed_at FROM assignments ORDER BY task_id,user_id", func(rs *sql.Rows) error {
		var id int64
		var p assignment
		if err := rs.Scan(&id, &p.User, &p.State, &p.CompletedAt); err != nil {
			return err
		}
		t := tasks[id]
		t.People = append(t.People, p)
		return nil
	})
	if err != nil {
		return err
	}
	s.Feed, err = pageEvents(tx, latestEvent)
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return reply(w, 200, s)
}
