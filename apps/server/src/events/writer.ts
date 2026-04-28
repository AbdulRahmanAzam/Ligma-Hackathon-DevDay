import type { BaseEvent, EventKind } from "@ligma/shared";
import { db } from "../db/sqlite.js";
import { RoomLamport } from "../util/lamport.js";

export interface WriteRequest {
  room_id: string;
  actor_id: string;
  node_id: string | null;
  kind: EventKind;
  payload: unknown;
  client_lamport: number;
  client_ts: number;
  causation_id: string | null;
  client_msg_id: string;
}

export type WriteResult =
  | { ok: true; event: BaseEvent }
  | { ok: false; reason: string };

const lamports = new Map<string, RoomLamport>();

function getLamport(roomId: string): RoomLamport {
  let l = lamports.get(roomId);
  if (!l) {
    const row = db
      .prepare("SELECT MAX(lamport) AS m FROM events WHERE room_id = ?")
      .get(roomId) as { m: number | null };
    l = new RoomLamport(row.m ?? 0);
    lamports.set(roomId, l);
  }
  return l;
}

const insert = db.prepare(`
  INSERT INTO events
    (room_id, actor_id, node_id, kind, payload, lamport, client_ts, causation_id, client_msg_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const findExisting = db.prepare(`
  SELECT seq, room_id, actor_id, node_id, kind, payload, lamport, client_ts, server_ts, causation_id, client_msg_id
  FROM events
  WHERE room_id = ? AND actor_id = ? AND client_msg_id = ?
`);

const fetchBySeq = db.prepare(`
  SELECT seq, room_id, actor_id, node_id, kind, payload, lamport, client_ts, server_ts, causation_id, client_msg_id
  FROM events
  WHERE seq = ?
`);

type EventRow = {
  seq: number;
  room_id: string;
  actor_id: string;
  node_id: string | null;
  kind: string;
  payload: string;
  lamport: number;
  client_ts: number;
  server_ts: number;
  causation_id: string | null;
  client_msg_id: string;
};

function rowToEvent(row: EventRow): BaseEvent {
  return {
    seq: row.seq,
    room_id: row.room_id,
    actor_id: row.actor_id,
    node_id: row.node_id,
    kind: row.kind as EventKind,
    payload: JSON.parse(row.payload),
    lamport: row.lamport,
    client_ts: row.client_ts,
    server_ts: row.server_ts,
    causation_id: row.causation_id,
    client_msg_id: row.client_msg_id,
  };
}

export function append(req: WriteRequest): WriteResult {
  const existing = findExisting.get(req.room_id, req.actor_id, req.client_msg_id) as
    | EventRow
    | undefined;
  if (existing) {
    return { ok: true, event: rowToEvent(existing) };
  }

  const lamport = getLamport(req.room_id);
  const stamped = lamport.tick(req.client_lamport);

  try {
    const info = insert.run(
      req.room_id,
      req.actor_id,
      req.node_id,
      req.kind,
      JSON.stringify(req.payload),
      stamped,
      req.client_ts,
      req.causation_id,
      req.client_msg_id,
    );
    const row = fetchBySeq.get(info.lastInsertRowid as number) as EventRow;
    return { ok: true, event: rowToEvent(row) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg };
  }
}

export function fetchSince(roomId: string, sinceSeq: number, limit = 5000): BaseEvent[] {
  const rows = db
    .prepare(
      `SELECT seq, room_id, actor_id, node_id, kind, payload, lamport, client_ts, server_ts, causation_id, client_msg_id
       FROM events WHERE room_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
    )
    .all(roomId, sinceSeq, limit) as EventRow[];
  return rows.map(rowToEvent);
}

export function maxSeq(roomId: string): number {
  const row = db
    .prepare("SELECT MAX(seq) AS m FROM events WHERE room_id = ?")
    .get(roomId) as { m: number | null };
  return row.m ?? 0;
}

export function maxLamport(roomId: string): number {
  return getLamport(roomId).current();
}
