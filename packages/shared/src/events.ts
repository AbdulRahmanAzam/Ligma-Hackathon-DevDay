export const EventKind = {
  NODE_CREATED: "node.created",
  NODE_DELETED: "node.deleted",
  NODE_MOVED: "node.moved",
  NODE_RESIZED: "node.resized",
  NODE_RESTYLED: "node.restyled",
  STICKY_TEXT_DELTA: "sticky.text.delta",
  STROKE_APPENDED: "stroke.appended",
  PERMISSION_GRANTED: "permission.granted",
  PERMISSION_REVOKED: "permission.revoked",
  ROLE_CHANGED: "role.changed",
  TASK_UPSERTED: "task.upserted",
  TASK_STATUS_SET: "task.status_set",
  INTENT_LABELED: "intent.labeled",
  SNAPSHOT_TAKEN: "snapshot.taken",
  PRESENCE_HEARTBEAT: "presence.heartbeat",
} as const;

export type EventKind = (typeof EventKind)[keyof typeof EventKind];

export interface BaseEvent {
  seq: number;
  room_id: string;
  actor_id: string;
  node_id: string | null;
  kind: EventKind;
  payload: unknown;
  lamport: number;
  client_ts: number;
  server_ts: number;
  causation_id: string | null;
  client_msg_id: string;
}

export interface NodeKind {
  STICKY: "sticky";
  SHAPE: "shape";
  TEXT: "text";
  DRAWING: "drawing";
}

export type NodeKindValue = "sticky" | "shape" | "text" | "drawing";

export type ShapeVariant = "rect" | "ellipse" | "arrow";

export interface NodeCreatedPayload {
  kind: NodeKindValue;
  x: number;
  y: number;
  w?: number;
  h?: number;
  fill?: string;
  stroke?: string;
  text?: string;
  shape?: ShapeVariant;
  /** For arrows: end point relative to (x, y). */
  end?: { x: number; y: number };
}

export interface NodeMovedPayload {
  x: number;
  y: number;
}

export interface NodeResizedPayload {
  w: number;
  h: number;
}

export interface NodeRestyledPayload {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  z?: number;
  rotation?: number;
}

export interface StickyTextDeltaPayload {
  yjs_update_b64: string;
}

export interface StrokeAppendedPayload {
  points: Array<{ x: number; y: number; p?: number }>;
  stroke: string;
  strokeWidth: number;
}

export interface IntentLabeledPayload {
  label: "action item" | "decision" | "open question" | "reference";
  score: number;
}

export interface PermissionPayload {
  user_id: string;
  role: "lead" | "contributor" | "viewer";
}

export interface TaskStatusSetPayload {
  task_id: string;
  status: "open" | "in_progress" | "done";
}
