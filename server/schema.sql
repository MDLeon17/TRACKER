PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
  password_hash BLOB NOT NULL, theme TEXT NOT NULL DEFAULT 'papel',
  joined_at TEXT NOT NULL, read_through INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_device ON sessions(device_id);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, due TEXT NOT NULL, repo TEXT NOT NULL,
  creator TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, completed_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, priority TEXT NOT NULL CHECK(priority IN ('alta','media','baja')),
  creator TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, completed_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
CREATE TABLE IF NOT EXISTS assignments (
  task_id INTEGER NOT NULL REFERENCES tasks(id), user_id TEXT NOT NULL REFERENCES users(id),
  state TEXT NOT NULL CHECK(state IN ('invited','accepted','declined','done')),
  completed_at TEXT NOT NULL DEFAULT '', PRIMARY KEY(task_id,user_id)
);
CREATE INDEX IF NOT EXISTS assignments_user ON assignments(user_id,state);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, actor TEXT NOT NULL REFERENCES users(id),
  project_id INTEGER REFERENCES projects(id), task_id INTEGER REFERENCES tasks(id),
  message TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS creation_requests (
  actor TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id), PRIMARY KEY(actor,request_key)
);
CREATE TABLE IF NOT EXISTS workspace_version (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT OR IGNORE INTO workspace_version VALUES(1,0);
