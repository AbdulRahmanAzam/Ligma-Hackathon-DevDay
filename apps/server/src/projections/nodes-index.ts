import { db } from "../db/sqlite.js";
import { EventKind, type BaseEvent } from "@ligma/shared";

const upsertNode = db.prepare(`
  INSERT INTO nodes (node_id, room_id, kind, created_by, created_seq)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(node_id) DO NOTHING
`);

const tombstone = db.prepare(`
  UPDATE nodes SET deleted_seq = ? WHERE node_id = ? AND deleted_seq IS NULL
`);

const grantPerm = db.prepare(`
  INSERT INTO node_permissions (node_id, user_id, role, granted_by, granted_seq)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(node_id, user_id) DO UPDATE SET role = excluded.role, granted_seq = excluded.granted_seq
`);

const revokePerm = db.prepare(`
  DELETE FROM node_permissions WHERE node_id = ? AND user_id = ?
`);

export function project(e: BaseEvent): void {
  if (e.kind === EventKind.NODE_CREATED && e.node_id) {
    const p = e.payload as { kind?: string };
    upsertNode.run(e.node_id, e.room_id, p.kind ?? "shape", e.actor_id, e.seq);
  } else if (e.kind === EventKind.NODE_DELETED && e.node_id) {
    tombstone.run(e.seq, e.node_id);
  } else if (e.kind === EventKind.PERMISSION_GRANTED && e.node_id) {
    const p = e.payload as { user_id: string; role: "lead" | "contributor" | "viewer" };
    grantPerm.run(e.node_id, p.user_id, p.role, e.actor_id, e.seq);
  } else if (e.kind === EventKind.PERMISSION_REVOKED && e.node_id) {
    const p = e.payload as { user_id: string };
    revokePerm.run(e.node_id, p.user_id);
  }
}
