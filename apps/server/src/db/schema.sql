-- LIGMA backend schema — adapted to his frontend's wire protocol.
-- Source of truth is the events table; shapes is a denormalized snapshot
-- so sync-welcome can ship the current state without replaying from seq=0.

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- Per-room append-only event log. Matches his CanvasEvent shape.
CREATE TABLE IF NOT EXISTS events (
  pk             INTEGER PRIMARY KEY AUTOINCREMENT,  -- internal monotonic
  id             TEXT NOT NULL,                       -- uuid (event.id)
  room_id        TEXT NOT NULL,
  seq            INTEGER NOT NULL,                    -- per-room monotonic
  at             TEXT NOT NULL,                       -- ISO timestamp
  label          TEXT NOT NULL,
  node_id        TEXT,
  operation      TEXT NOT NULL CHECK (operation IN ('created','updated','deleted')),
  source         TEXT NOT NULL CHECK (source IN ('user','remote')),
  author_name    TEXT NOT NULL,
  author_role    TEXT NOT NULL CHECK (author_role IN ('Lead','Contributor','Viewer'))
);
CREATE INDEX IF NOT EXISTS idx_events_room_seq  ON events(room_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_room_pk ON events(room_id, pk);
CREATE INDEX IF NOT EXISTS idx_events_room_node ON events(room_id, node_id, seq);

-- Current TLShape snapshot per room. JSON-encoded. Updated on every accepted
-- canvas-delta. Used by sync-welcome and reconnect.
CREATE TABLE IF NOT EXISTS shapes (
  room_id   TEXT NOT NULL,
  shape_id  TEXT NOT NULL,
  shape     TEXT NOT NULL,           -- JSON of TLShape
  updated_seq INTEGER NOT NULL,
  PRIMARY KEY (room_id, shape_id)
);
CREATE INDEX IF NOT EXISTS idx_shapes_room ON shapes(room_id);

-- Per-room Yjs Y.Doc snapshot for the tasks Y.Array. Stored as a single
-- update blob; rewritten periodically and on broadcast.
CREATE TABLE IF NOT EXISTS task_docs (
  room_id    TEXT PRIMARY KEY,
  doc_blob   BLOB NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);

-- Auth: same as before.
CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  display    TEXT NOT NULL,
  pw_hash    TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
);

CREATE TABLE IF NOT EXISTS rooms (
  room_id      TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  owner_id     TEXT NOT NULL REFERENCES users(user_id),
  default_role TEXT NOT NULL DEFAULT 'Contributor' CHECK (default_role IN ('Lead','Contributor','Viewer')),
  created_at   INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  archived_at  INTEGER
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role    TEXT NOT NULL CHECK (role IN ('Lead','Contributor','Viewer')),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);
