import * as Y from "yjs";
import { db } from "../db/sqlite.js";
import type { CanvasEvent, Role, TLShape, WsServerMsg } from "./types.js";
import type { WebSocket } from "ws";

export interface ClientSession {
  user_id: string;
  sessionId: string;
  name: string;
  color: string;
  role: Role;
  socket: WebSocket;
}

interface RoomRuntime {
  clients: Map<string, ClientSession>;
  taskDoc: Y.Doc;
  // Shapes are loaded lazily from SQLite via getShapesSnapshot();
  // we don't keep them in-memory because reconnect/restart should rebuild
  // from the DB anyway.
}

const rooms = new Map<string, RoomRuntime>();

function ensureRoom(roomId: string): RoomRuntime {
  let r = rooms.get(roomId);
  if (!r) {
    const taskDoc = new Y.Doc();
    // Load persisted task doc state if any.
    const row = db
      .prepare("SELECT doc_blob FROM task_docs WHERE room_id = ?")
      .get(roomId) as { doc_blob: Buffer } | undefined;
    if (row?.doc_blob) {
      try {
        Y.applyUpdate(taskDoc, new Uint8Array(row.doc_blob));
      } catch (err) {
        console.warn(`[room] failed to restore taskDoc for ${roomId}:`, err);
      }
    }
    r = { clients: new Map(), taskDoc };
    rooms.set(roomId, r);
  }
  return r;
}

export function joinRoom(roomId: string, session: ClientSession): RoomRuntime {
  const r = ensureRoom(roomId);
  r.clients.set(session.sessionId, session);
  return r;
}

export function leaveRoom(roomId: string, sessionId: string): void {
  const r = rooms.get(roomId);
  if (!r) return;
  r.clients.delete(sessionId);
  // Persist task doc on last leave so we don't lose unflushed updates.
  if (r.clients.size === 0) {
    persistTaskDoc(roomId, r.taskDoc);
  }
}

export function getRoom(roomId: string): RoomRuntime | null {
  return rooms.get(roomId) ?? null;
}

export function broadcast(roomId: string, msg: WsServerMsg, except?: string): void {
  const r = rooms.get(roomId);
  if (!r) return;
  const data = JSON.stringify(msg);
  for (const c of r.clients.values()) {
    if (except && c.sessionId === except) continue;
    if (c.socket.readyState !== c.socket.OPEN) continue;
    try {
      c.socket.send(data);
    } catch {
      /* socket closing; reaper will pick up */
    }
  }
}

export function send(socket: WebSocket, msg: WsServerMsg): void {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(msg));
  } catch {
    /* socket closing */
  }
}

export function activeUserList(roomId: string): Array<{
  sessionId: string;
  name: string;
  color: string;
  role: Role;
}> {
  const r = rooms.get(roomId);
  if (!r) return [];
  return Array.from(r.clients.values()).map(({ sessionId, name, color, role }) => ({
    sessionId,
    name,
    color,
    role,
  }));
}

export function totalRooms(): number {
  return rooms.size;
}

// --- persistence ---

const insertEvent = db.prepare(`
  INSERT INTO events (id, room_id, seq, at, label, node_id, operation, source, author_name, author_role, shape_json, cursor_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const upsertShape = db.prepare(`
  INSERT INTO shapes (room_id, shape_id, shape, updated_seq)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(room_id, shape_id) DO UPDATE SET shape = excluded.shape, updated_seq = excluded.updated_seq
`);

const deleteShape = db.prepare(`
  DELETE FROM shapes WHERE room_id = ? AND shape_id = ?
`);

const fetchShape = db.prepare(`
  SELECT shape FROM shapes WHERE room_id = ? AND shape_id = ?
`);

const allShapes = db.prepare(`
  SELECT shape FROM shapes WHERE room_id = ? ORDER BY updated_seq ASC
`);

const eventsSince = db.prepare(`
  SELECT id, seq, at, label, node_id AS nodeId, operation, source, author_name AS authorName, author_role AS authorRole,
         shape_json AS shapeJson, cursor_json AS cursorJson
  FROM events WHERE room_id = ? AND seq > ? ORDER BY seq ASC
`);

const maxSeqStmt = db.prepare(`SELECT MAX(seq) AS m FROM events WHERE room_id = ?`);

const upsertTaskDoc = db.prepare(`
  INSERT INTO task_docs (room_id, doc_blob, updated_at)
  VALUES (?, ?, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(room_id) DO UPDATE SET doc_blob = excluded.doc_blob, updated_at = excluded.updated_at
`);

export function nextSeq(roomId: string): number {
  const row = maxSeqStmt.get(roomId) as { m: number | null };
  return (row.m ?? 0) + 1;
}

export function persistEvent(roomId: string, ev: CanvasEvent): void {
  insertEvent.run(
    ev.id,
    roomId,
    ev.seq,
    ev.at,
    ev.label,
    ev.nodeId ?? null,
    ev.operation,
    ev.source,
    ev.authorName,
    ev.authorRole,
    ev.shape ? JSON.stringify(ev.shape) : null,
    ev.cursor ? JSON.stringify(ev.cursor) : null,
  );
}

export function persistShape(roomId: string, shape: TLShape, seq: number): void {
  upsertShape.run(roomId, shape.id, JSON.stringify(shape), seq);
}

export function removeShape(roomId: string, shapeId: string): void {
  deleteShape.run(roomId, shapeId);
}

export function getShape(roomId: string, shapeId: string): TLShape | null {
  const row = fetchShape.get(roomId, shapeId) as { shape: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.shape) as TLShape;
  } catch {
    return null;
  }
}

export function getShapesSnapshot(roomId: string): TLShape[] {
  const rows = allShapes.all(roomId) as Array<{ shape: string }>;
  const out: TLShape[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.shape) as TLShape);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export function getEventsSince(roomId: string, sinceSeq: number): CanvasEvent[] {
  const rows = eventsSince.all(roomId, sinceSeq) as Array<{
    id: string;
    seq: number;
    at: string;
    label: string;
    nodeId: string | null;
    operation: "created" | "updated" | "deleted";
    source: "user" | "remote";
    authorName: string;
    authorRole: Role;
    shapeJson: string | null;
    cursorJson: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    at: r.at,
    label: r.label,
    nodeId: r.nodeId ?? undefined,
    operation: r.operation,
    source: r.source,
    authorName: r.authorName,
    authorRole: r.authorRole,
    shape: r.shapeJson ? safeParseJson(r.shapeJson) : undefined,
    cursor: r.cursorJson ? safeParseJson(r.cursorJson) : undefined,
  }));
}

function safeParseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function persistTaskDoc(roomId: string, doc: Y.Doc): void {
  const update = Y.encodeStateAsUpdate(doc);
  upsertTaskDoc.run(roomId, Buffer.from(update));
}
