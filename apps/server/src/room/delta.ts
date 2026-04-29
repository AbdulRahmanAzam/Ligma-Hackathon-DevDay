import { v4 as uuid } from "uuid";
import type { CanvasEvent, Role, SyncDelta, TLShape } from "./types.js";
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
  };
}

/**
 * Validate a canvas-delta from a client and apply allowed mutations.
 * Persists events + shapes inside this call. Caller broadcasts the result.
 */
export function validateAndApplyDelta(
  roomId: string,
  client: { name: string; role: Role },
  incoming: SyncDelta | undefined,
): ApplyResult {
  const delta: SyncDelta = {
    added: incoming?.added ?? {},
    updated: incoming?.updated ?? {},
    removed: incoming?.removed ?? {},
  };
  const acceptedDelta: SyncDelta = { added: {}, updated: {}, removed: {} };
  const events: CanvasEvent[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];

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
    });
    persistEvent(roomId, ev);
    persistShape(roomId, shape, seq);
    acceptedDelta.added[shape.id] = shape;
    events.push(ev);
  }

  // UPDATED — RBAC against the *previous* server-state record. Lock-set
  // changes additionally require Lead.
  for (const entry of Object.values(delta.updated)) {
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
    const seq = nextSeq(roomId);
    const ev = makeEvent({
      operation: "updated",
      shape: next,
      authorName: client.name,
      authorRole: client.role,
      seq,
    });
    persistEvent(roomId, ev);
    persistShape(roomId, next, seq);
    acceptedDelta.updated[next.id] = stored ? [stored, next] : next;
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
    });
    persistEvent(roomId, ev);
    removeShape(roomId, shape.id);
    acceptedDelta.removed[shape.id] = stored;
    events.push(ev);
  }

  return { acceptedDelta, events, rejected };
}
