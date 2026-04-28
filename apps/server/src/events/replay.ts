import { db } from "../db/sqlite.js";
import { fetchSince } from "./writer.js";
import type { BaseEvent } from "@ligma/shared";

/**
 * Per spec §4.5. The same code path powers boot, reconnect-and-replay, and time-travel —
 * different `target` values, identical algorithm:
 *   1. Find the latest snapshot with upto_seq <= target (or null if no snapshot).
 *   2. Fetch all events in (snapshot.upto_seq, target].
 *   3. Caller folds them over their projection / Y.Doc.
 */
export interface ReplaySource {
  snapshot: { upto_seq: number; doc_blob: Buffer } | null;
  events: BaseEvent[];
}

const findSnap = db.prepare(`
  SELECT upto_seq, doc_blob FROM snapshots
  WHERE room_id = ? AND upto_seq <= ?
  ORDER BY upto_seq DESC LIMIT 1
`);

export function rebuildSource(roomId: string, target = Number.MAX_SAFE_INTEGER): ReplaySource {
  const snap = findSnap.get(roomId, target) as
    | { upto_seq: number; doc_blob: Buffer }
    | undefined;
  const fromSeq = snap?.upto_seq ?? 0;
  const upper = target === Number.MAX_SAFE_INTEGER ? 1_000_000_000 : target;
  const events = fetchSince(roomId, fromSeq, upper - fromSeq + 1).filter(
    (e) => e.seq <= upper,
  );
  return { snapshot: snap ?? null, events };
}
