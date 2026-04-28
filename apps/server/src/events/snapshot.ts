import { db } from "../db/sqlite.js";
import { gzipSync } from "node:zlib";
import { maxSeq, maxLamport } from "./writer.js";

/**
 * Per spec §4.4. We snapshot every SNAPSHOT_INTERVAL events per room.
 * Instead of encoding a Y.Doc state vector (which would couple us to a particular
 * CRDT shape), we serialize the projection of each room — the events table in JSON.
 * That keeps replay deterministic and the snapshot useful for boot caching.
 *
 * The blob is gzipped JSON of the events from upto_seq..now, so a reader can
 * fold it on top of the previous snapshot to reach any seq.
 */
const INTERVAL = Number(process.env.SNAPSHOT_INTERVAL ?? 200);

const insertSnap = db.prepare(`
  INSERT OR REPLACE INTO snapshots (room_id, upto_seq, doc_blob, lamport_max)
  VALUES (?, ?, ?, ?)
`);

const recentEvents = db.prepare(`
  SELECT seq, room_id, actor_id, node_id, kind, payload, lamport, client_ts, server_ts, causation_id, client_msg_id
  FROM events WHERE room_id = ? AND seq > ? ORDER BY seq ASC
`);

const recentSnapBefore = db.prepare(`
  SELECT upto_seq FROM snapshots WHERE room_id = ? ORDER BY upto_seq DESC LIMIT 1
`);

const eventCount = new Map<string, number>();

export function maybeSnapshot(roomId: string): void {
  const n = (eventCount.get(roomId) ?? 0) + 1;
  eventCount.set(roomId, n);
  if (n < INTERVAL) return;
  eventCount.set(roomId, 0);

  const upto = maxSeq(roomId);
  const lastSnap =
    (recentSnapBefore.get(roomId) as { upto_seq: number } | undefined)?.upto_seq ?? 0;
  const events = recentEvents.all(roomId, lastSnap);
  const blob = gzipSync(Buffer.from(JSON.stringify(events), "utf8"));
  insertSnap.run(roomId, upto, blob, maxLamport(roomId));
}
