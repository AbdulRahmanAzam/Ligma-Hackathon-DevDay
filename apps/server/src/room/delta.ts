import { v4 as uuid } from "uuid";
import type { CanvasEvent, CursorPayload, Role, SyncDelta, TLShape } from "./types.js";
import {
  getShape,
  nextSeq,
  persistEvent,
  persistShape,
  removeShape,
} from "./registry.js";

interface ApplyResult {
  acceptedDelta: SyncDelta;
  events: CanvasEvent[];
  rejected: Array<{ id: string; reason: string }>;
}

function isShapeRecord(v: unknown): v is TLShape {
  return Boolean(
    v && typeof v === "object" && "typeName" in (v as object) &&
      (v as { typeName?: unknown }).typeName === "shape" &&
      typeof (v as { id?: unknown }).id === "string",
  );
}

function describeShape(shape: TLShape): string {
  switch (shape.type) {
    case "note":
      return "sticky note";
    case "draw":
      return "freehand drawing";
    case "text":
      return "text block";
    case "geo":
      return "shape";
    default:
      return shape.type ?? "node";
  }
}

function lockedRoles(shape: TLShape): Role[] {
  const meta = (shape.meta as { ligma?: { lockedToRoles?: unknown } })?.ligma;
  if (!meta) return [];
  return Array.isArray(meta.lockedToRoles)
    ? (meta.lockedToRoles.filter((r) => r === "Lead" || r === "Contributor" || r === "Viewer") as Role[])
    : [];
}

function canMutate(shape: TLShape, role: Role): boolean {
  if (shape.type === "draw") return role !== "Viewer";
  const locked = lockedRoles(shape);
  return locked.length === 0 || locked.includes(role);
}

function lockedReason(shape: TLShape): string {
  const locked = lockedRoles(shape);
  return locked.length === 0
    ? "Locked"
    : `Locked to ${locked.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Conflict Resolution Strategy: Property-Level Merge
// When concurrent edits modify different properties of the same shape,
// we merge at the property level rather than replacing the entire shape.
// Same-property conflicts use last-writer-wins with sequence ordering.
// This is conceptually similar to a CRDT register per property.
// ---------------------------------------------------------------------------

/**
 * Deep-merge `patch` into `target`, returning a new object.
 * For plain objects, recurse; for everything else (arrays, primitives) the
 * patch value wins (last-writer-wins at the leaf level).
 */
function deepMerge<T extends Record<string, unknown>>(target: T, patch: Record<string, unknown>): T {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(patch)) {
    const tVal = (target as Record<string, unknown>)[key];
    const pVal = patch[key];
    if (
      pVal !== null &&
      typeof pVal === "object" &&
      !Array.isArray(pVal) &&
      tVal !== null &&
      typeof tVal === "object" &&
      !Array.isArray(tVal)
    ) {
      result[key] = deepMerge(tVal as Record<string, unknown>, pVal as Record<string, unknown>);
    } else {
      result[key] = pVal;
    }
  }
  return result as T;
}

/**
 * Given the previous shape (`prev`) and the desired next shape (`next`),
 * compute the set of top-level and nested properties that actually changed.
 * Returns an object containing only the changed keys (with their `next` values).
 */
function computeChangedProps(prev: TLShape, next: TLShape): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(next)) {
    if (key === "id" || key === "typeName") continue; // identity keys — never "change"
    const pVal = (prev as Record<string, unknown>)[key];
    const nVal = (next as Record<string, unknown>)[key];
    // Fast-path: reference equality means no change
    if (pVal === nVal) continue;
    // Structural comparison via JSON (safe for the JSON-serialisable TLShape data)
    if (JSON.stringify(pVal) !== JSON.stringify(nVal)) {
      changed[key] = nVal;
    }
  }
  return changed;
}

/**
 * Merge an incoming update into the server's authoritative shape.
 * Only the properties that the client actually changed (diff of prev→next)
 * are applied to `serverShape`, so concurrent edits to *different* properties
 * by different users are preserved.
 */
function mergeShape(serverShape: TLShape, prev: TLShape | null, next: TLShape): TLShape {
  // If there is no prev (client sent bare shape instead of [prev, next] tuple),
  // or no server shape to merge against, fall back to full replacement.
  if (!prev) return next;

  const changedProps = computeChangedProps(prev, next);
  // Nothing actually changed — return server state as-is.
  if (Object.keys(changedProps).length === 0) return serverShape;

  return deepMerge(serverShape, changedProps);
}

/** Privileged check: lock-set changes require Lead. */
function isLockChange(prev: TLShape | null, next: TLShape): boolean {
  const prevLocks = prev ? lockedRoles(prev) : [];
  const nextLocks = lockedRoles(next);
  if (prevLocks.length !== nextLocks.length) return true;
  const a = [...prevLocks].sort().join(",");
  const b = [...nextLocks].sort().join(",");
  return a !== b;
}

function makeEvent(opts: {
  operation: "created" | "updated" | "deleted";
  shape: TLShape;
  authorName: string;
  authorRole: Role;
  seq: number;
  cursor?: CursorPayload;
}): CanvasEvent {
  return {
    id: `evt-${uuid()}`,
    seq: opts.seq,
    at: new Date().toISOString(),
    label: `${opts.operation[0]!.toUpperCase()}${opts.operation.slice(1)} ${describeShape(opts.shape)}`,
    nodeId: opts.shape.id,
    operation: opts.operation,
    source: "user",
    authorName: opts.authorName,
    authorRole: opts.authorRole,
    shape: opts.shape,
    cursor: opts.cursor,
  };
}

/**
 * Validate a canvas-delta from a client and apply allowed mutations.
 * Persists events + shapes inside this call. Caller broadcasts the result.
 */
export function validateAndApplyDelta(
  roomId: string,
  client: { name: string; role: Role; sessionId: string; color: string },
  incoming: SyncDelta | undefined,
  cursor?: { x: number; y: number },
): ApplyResult {
  const delta: SyncDelta = {
    added: incoming?.added ?? {},
    updated: incoming?.updated ?? {},
    removed: incoming?.removed ?? {},
  };
  const acceptedDelta: SyncDelta = { added: {}, updated: {}, removed: {} };
  const events: CanvasEvent[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];

  const cursorPayload: CursorPayload | undefined =
    cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y)
      ? {
          sessionId: client.sessionId,
          name: client.name,
          role: client.role,
          color: client.color,
          x: cursor.x,
          y: cursor.y,
        }
      : undefined;

  // CREATED — anyone with non-Viewer role can create. Viewer is read-only.
  for (const shape of Object.values(delta.added)) {
    if (!isShapeRecord(shape)) continue;
    if (client.role === "Viewer") {
      rejected.push({ id: shape.id, reason: "Viewer cannot create" });
      continue;
    }
    // If creator stamps a lockedToRoles array, that's OK (they're authoring;
    // they've already passed RBAC for create). But Viewer shouldn't have
    // gotten this far.
    const seq = nextSeq(roomId);
    const ev = makeEvent({
      operation: "created",
      shape,
      authorName: client.name,
      authorRole: client.role,
      seq,
      cursor: cursorPayload,
    });
    persistEvent(roomId, ev);
    persistShape(roomId, shape, seq);
    acceptedDelta.added[shape.id] = shape;
    events.push(ev);
  }

  // UPDATED — RBAC against the *previous* server-state record. Lock-set
  // changes additionally require Lead.
  // Property-level merge: only the properties the client actually changed
  // (diffed from the prev→next pair) are applied to the server's current
  // shape, so concurrent edits to different properties both survive.
  for (const entry of Object.values(delta.updated)) {
    const prev = Array.isArray(entry) ? entry[0] : null;
    const next = Array.isArray(entry) ? entry[1] : (entry as TLShape);
    if (!isShapeRecord(next)) continue;
    const stored = getShape(roomId, next.id);
    const referenceShape = stored ?? next;
    if (!canMutate(referenceShape, client.role)) {
      rejected.push({ id: next.id, reason: lockedReason(referenceShape) });
      continue;
    }
    if (isLockChange(stored, next) && client.role !== "Lead") {
      rejected.push({ id: next.id, reason: "Lock changes require Lead" });
      continue;
    }

    // Property-level merge: apply only changed fields to the server shape.
    const merged = stored ? mergeShape(stored, prev, next) : next;

    const seq = nextSeq(roomId);
    const ev = makeEvent({
      operation: "updated",
      shape: merged,
      authorName: client.name,
      authorRole: client.role,
      seq,
      cursor: cursorPayload,
    });
    persistEvent(roomId, ev);
    persistShape(roomId, merged, seq);
    acceptedDelta.updated[next.id] = stored ? [stored, merged] : merged;
    events.push(ev);
  }

  // REMOVED — same RBAC. Lookup by stored shape; respect locks.
  for (const shape of Object.values(delta.removed)) {
    if (!isShapeRecord(shape)) continue;
    const stored = getShape(roomId, shape.id) ?? shape;
    if (!canMutate(stored, client.role)) {
      rejected.push({ id: shape.id, reason: lockedReason(stored) });
      continue;
    }
    const seq = nextSeq(roomId);
    const ev = makeEvent({
      operation: "deleted",
      shape: stored,
      authorName: client.name,
      authorRole: client.role,
      seq,
      cursor: cursorPayload,
    });
    persistEvent(roomId, ev);
    removeShape(roomId, shape.id);
    acceptedDelta.removed[shape.id] = stored;
    events.push(ev);
  }

  return { acceptedDelta, events, rejected };
}
