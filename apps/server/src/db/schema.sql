-- LIGMA schema: events table is the only durable source of truth.
-- All other tables are projections, lookups, or snapshots (per spec §3).

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- 3.1 events: append-only source of truth
CREATE TABLE IF NOT EXISTS events (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id        TEXT NOT NULL,
  actor_id       TEXT NOT NULL,
  node_id        TEXT,
  kind           TEXT NOT NULL,
  payload        TEXT NOT NULL,
  lamport        INTEGER NOT NULL,
  client_ts      INTEGER NOT NULL,
  server_ts      INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  causation_id   TEXT,
  client_msg_id  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_room_seq  ON events(room_id, seq);
CREATE INDEX IF NOT EXISTS idx_events_room_node ON events(room_id, node_id, seq);
CREATE INDEX IF NOT EXISTS idx_events_room_kind ON events(room_id, kind, seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedup ON events(room_id, actor_id, client_msg_id);

-- 3.2 snapshots: bounded replay cost
CREATE TABLE IF NOT EXISTS snapshots (
  room_id     TEXT NOT NULL,
  upto_seq    INTEGER NOT NULL,
  doc_blob    BLOB NOT NULL,
  lamport_max INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  PRIMARY KEY (room_id, upto_seq)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_room_recent ON snapshots(room_id, upto_seq DESC);

-- 3.3 nodes: denormalized projection for RBAC + projections (rebuilt from events)
CREATE TABLE IF NOT EXISTS nodes (
  node_id     TEXT PRIMARY KEY,
  room_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_seq INTEGER NOT NULL,
  deleted_seq INTEGER
);
CREATE INDEX IF NOT EXISTS idx_nodes_room ON nodes(room_id) WHERE deleted_seq IS NULL;

-- 3.4 node_permissions: per-node RBAC override
CREATE TABLE IF NOT EXISTS node_permissions (
  node_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('lead','contributor','viewer')),
  granted_by  TEXT NOT NULL,
  granted_seq INTEGER NOT NULL,
  PRIMARY KEY (node_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_perm_user ON node_permissions(user_id);

-- 3.5 tasks: Task Board projection
CREATE TABLE IF NOT EXISTS tasks (
  task_id     TEXT PRIMARY KEY,
  room_id     TEXT NOT NULL,
  source_node TEXT NOT NULL,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  ai_score    REAL NOT NULL,
  created_seq INTEGER NOT NULL,
  updated_seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_room ON tasks(room_id, status, updated_seq);

-- 3.6 users + rooms
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
  default_role TEXT NOT NULL DEFAULT 'contributor',
  created_at   INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
  archived_at  INTEGER
);

-- room_members: who has what default role in a room (room-wide override)
CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role    TEXT NOT NULL CHECK (role IN ('lead','contributor','viewer')),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);

-- 3.7 rbac_role_ops: role x op-kind matrix (seeded at boot from shared package)
CREATE TABLE IF NOT EXISTS rbac_role_ops (
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (role, kind)
);

-- Ring 3 enforcement: BEFORE INSERT trigger that verifies the actor's effective
-- role on the node permits the kind. Catches any Ring 2 bug before state mutates.
DROP TRIGGER IF EXISTS trg_events_rbac_check;
CREATE TRIGGER trg_events_rbac_check
BEFORE INSERT ON events
FOR EACH ROW
WHEN NEW.node_id IS NOT NULL
BEGIN
  SELECT CASE
    -- Case 1: actor has a node-level permission row. Use that role.
    WHEN (
      SELECT role FROM node_permissions
      WHERE node_id = NEW.node_id AND user_id = NEW.actor_id
    ) IS NOT NULL
      AND NEW.kind NOT IN (
        SELECT kind FROM rbac_role_ops
        WHERE role = (
          SELECT role FROM node_permissions
          WHERE node_id = NEW.node_id AND user_id = NEW.actor_id
        )
      )
    THEN RAISE(ABORT, 'rbac_denied: node-role forbids op')

    -- Case 2: no node-level row. Fall back to room_members role; else default_role.
    WHEN (
      SELECT role FROM node_permissions
      WHERE node_id = NEW.node_id AND user_id = NEW.actor_id
    ) IS NULL
      AND NEW.kind NOT IN (
        SELECT kind FROM rbac_role_ops
        WHERE role = COALESCE(
          (SELECT role FROM room_members
            WHERE room_id = NEW.room_id AND user_id = NEW.actor_id),
          (SELECT default_role FROM rooms WHERE room_id = NEW.room_id)
        )
      )
    THEN RAISE(ABORT, 'rbac_denied: room-role forbids op')
  END;
END;

-- Privileged kinds (PERMISSION_*, ROLE_CHANGED) must come from a Lead.
-- Even when node_id IS NULL we still want this guard. A separate trigger handles it.
DROP TRIGGER IF EXISTS trg_events_privileged_check;
CREATE TRIGGER trg_events_privileged_check
BEFORE INSERT ON events
FOR EACH ROW
WHEN NEW.kind IN ('permission.granted', 'permission.revoked', 'role.changed')
BEGIN
  SELECT CASE
    WHEN COALESCE(
      (SELECT role FROM room_members
        WHERE room_id = NEW.room_id AND user_id = NEW.actor_id),
      (SELECT default_role FROM rooms WHERE room_id = NEW.room_id)
    ) <> 'lead'
    THEN RAISE(ABORT, 'rbac_denied: privileged op requires lead')
  END;
END;
