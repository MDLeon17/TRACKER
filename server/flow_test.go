package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type testClient struct {
	t      *testing.T
	base   string
	client *http.Client
}

func newClient(t *testing.T, base string) *testClient {
	jar, _ := cookiejar.New(nil)
	c := &testClient{t: t, base: base, client: &http.Client{Jar: jar}}
	c.call("GET", "session", nil, 200)
	return c
}
func (c *testClient) call(method, path string, body any, status int, keys ...string) []byte {
	c.t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		c.t.Fatal(err)
	}
	req, err := http.NewRequest(method, c.base+"/api/"+path, bytes.NewReader(b))
	if err != nil {
		c.t.Fatal(err)
	}
	if len(keys) > 0 {
		req.Header.Set("Idempotency-Key", keys[0])
	}
	if method == "POST" {
		req.Header.Set("Content-Type", "application/json")
	}
	r, err := c.client.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer r.Body.Close()
	data, err := io.ReadAll(r.Body)
	if err != nil {
		c.t.Fatal(err)
	}
	if r.StatusCode != status {
		c.t.Fatalf("%s %s: got %d, want %d: %s", method, path, r.StatusCode, status, data)
	}
	return data
}
func (c *testClient) registerPerson(name, password string) member {
	var me member
	if err := json.Unmarshal(c.call("POST", "register", credentials{Name: name, Password: password}, 201), &me); err != nil {
		c.t.Fatal(err)
	}
	return me
}
func (c *testClient) board() snapshot {
	var out snapshot
	if err := json.Unmarshal(c.call("GET", "workspace", nil, 200), &out); err != nil {
		c.t.Fatal(err)
	}
	return out
}
func TestTeamWorkflow(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "team.sqlite")
	a, err := openApp(dbPath, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.db.Close() })
	srv := httptest.NewServer(a.router())
	defer srv.Close()
	p, q, r := newClient(t, srv.URL), newClient(t, srv.URL), newClient(t, srv.URL)
	p.call("GET", "workspace", nil, 401)
	const passA = "clave-personal-alfa"
	const passB = "clave-personal-beta"
	const passC = "clave-personal-gama"
	alfa := p.registerPerson("Alfa", passA)
	beta := q.registerPerson("Beta", passB)
	gama := r.registerPerson("Gama", passC)
	if alfa.ID == beta.ID || !strings.HasPrefix(alfa.ID, "RV-") {
		t.Fatal("device identity")
	}
	p.call("POST", "register", credentials{Name: "Otro", Password: passA}, 409)
	p.call("POST", "theme", map[string]any{"theme": "grafito"}, 200)
	if p.board().Me.Theme != "grafito" || q.board().Me.Theme != "papel" {
		t.Fatal("theme isolation")
	}
	proj := map[string]any{"name": "Entrega de prueba", "due": "2027-08-01", "repo": "https://gitlab.com/grupo/subgrupo/producto",
		"tasks": []newTask{{"Interfaz", "alta", []string{alfa.ID, beta.ID}}, {"Documentar", "media", []string{"desconocido"}}}}
	p.call("POST", "projects", proj, 400)
	if len(q.board().Projects) != 0 {
		t.Fatal("partial project persisted")
	}
	proj["tasks"] = []newTask{{"Interfaz", "alta", []string{alfa.ID, beta.ID}}}
	p.call("POST", "projects", proj, 201, "proyecto-unico-0001")
	p.call("POST", "projects", proj, 201, "proyecto-unico-0001")
	r.call("POST", "projects/1/tasks", newTask{"Documentar", "baja", []string{beta.ID}}, 201, "objetivo-unico-0002")
	r.call("POST", "projects/1/tasks", newTask{"Documentar", "baja", []string{beta.ID}}, 201, "objetivo-unico-0002")
	r.call("POST", "projects/1/tasks", newTask{"Cambió", "alta", []string{beta.ID}}, 409, "objetivo-unico-0002")
	created := r.board()
	if len(created.Projects) != 1 || len(created.Projects[0].Tasks) != 2 {
		t.Fatal("duplicate after HTTP retry")
	}
	p.call("POST", "tasks/2/respond", map[string]string{"decision": "accepted"}, 403)
	r.call("POST", "tasks/1/complete", map[string]string{"password": passC}, 403)
	q.call("POST", "tasks/1/complete", map[string]string{"password": passB}, 409)
	q.call("POST", "tasks/1/respond", map[string]string{"decision": "accepted"}, 200)
	q.call("POST", "tasks/1/complete", map[string]string{"password": "incorrecta"}, 403)
	q.call("POST", "tasks/2/respond", map[string]string{"decision": "declined"}, 200)
	p.call("POST", "tasks/2/assign", map[string]any{"people": []string{gama.ID}}, 200)
	r.call("POST", "tasks/2/respond", map[string]string{"decision": "accepted"}, 200)
	r.call("POST", "tasks/2/complete", map[string]string{"password": passC}, 200)
	p.call("POST", "tasks/1/complete", map[string]string{"password": passA}, 200)
	if p.board().Projects[0].Tasks[0].CompletedAt != "" {
		t.Fatal("joint task closed early")
	}
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); q.call("POST", "tasks/1/complete", map[string]string{"password": passB}, 200) }()
	}
	wg.Wait()
	board := p.board()
	if board.Projects[0].CompletedAt == "" || board.Projects[0].Tasks[0].CompletedAt == "" {
		t.Fatal("missing archive")
	}
	count := 0
	for _, e := range board.Feed.Events {
		if e.Kind == "confirmed" {
			count++
		}
		if e.At == "" {
			t.Fatal("missing event timestamp")
		}
	}
	if count != 3 {
		t.Fatalf("expected 3 distinct confirmations, got %d", count)
	}
	for _, as := range board.Projects[0].Tasks[0].People {
		if as.State != "done" || as.CompletedAt == "" {
			t.Fatal("bad personal history")
		}
	}
	p.call("POST", "projects/1/tasks", newTask{"Tardío", "media", []string{alfa.ID}}, 409)
	p.call("POST", "notifications/read", map[string]any{"through": board.Feed.Events[0].ID}, 200)
	if p.board().Unread != 0 || q.board().Unread == 0 {
		t.Fatal("read receipts leaked between users")
	}
	p.call("POST", "logout", nil, 200)
	p.call("GET", "workspace", nil, 401)
	p.call("POST", "login", credentials{Name: alfa.ID, Password: passA}, 200)
	otherDevice := newClient(t, srv.URL)
	otherDevice.call("POST", "login", credentials{Name: "Alfa", Password: passA}, 200)
	if otherDevice.board().Me.ID != alfa.ID {
		t.Fatal("recovery changed account identity")
	}
	reopened, err := openApp(dbPath, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.db.Close()
	var archived int
	if err = reopened.db.QueryRow("SELECT COUNT(*) FROM projects WHERE completed_at<>''").Scan(&archived); err != nil || archived != 1 {
		t.Fatal("archive did not persist", err)
	}
}
