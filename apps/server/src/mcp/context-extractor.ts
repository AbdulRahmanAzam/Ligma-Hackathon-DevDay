/**
 * Pulls task context from the persisted canvas state.
 * Sources:
 *  - shapes table: current TLShape JSON snapshot (rich text + intent meta + position)
 *  - events table: author/role/createdAt of the original NODE_CREATED event
 *  - room_members + users: participant roster
 *  - rooms: room name
 */
import { db } from "../db/sqlite.js";
import type { TaskContext, TaskInfo } from "./types.js";

interface ShapeRow {
  shape_id: string;
  shape: string;
}

interface EventRow {
  author_name: string;
  author_role: string;
  at: string;
}

interface RoomRow {
  name: string;
}

interface ParticipantRow {
  display: string;
  role: string;
}

interface ParsedShape {
  id: string;
  type: string;
  x?: number;
  y?: number;
  props?: {
    text?: string;
    richText?: { text?: string } | { content?: unknown[] } | string;
  } & Record<string, unknown>;
  meta?: {
    intent?: string;
    authorName?: string;
    authorRole?: string;
    createdAt?: string;
  } & Record<string, unknown>;
}

const PLAIN_TEXT_KEYS = ["text", "plaintext", "value"] as const;

function richTextToPlain(rich: unknown): string {
  if (!rich) return "";
  if (typeof rich === "string") return rich;
  if (typeof rich !== "object") return "";

  // tldraw stores rich text as a tiptap-style doc { type, content: [...] }.
  const node = rich as Record<string, unknown>;
  for (const k of PLAIN_TEXT_KEYS) {
    const v = node[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  if (Array.isArray(node.content)) {
    return node.content.map((c) => richTextToPlain(c)).join(" ");
  }
  return "";
}

function shapeText(shape: ParsedShape): string {
  const props = shape.props ?? {};
  if (typeof props.text === "string" && props.text.trim()) return props.text;
  const r = richTextToPlain(props.richText);
  return r.trim();
}

function parseShape(json: string): ParsedShape | null {
  try {
    return JSON.parse(json) as ParsedShape;
  } catch {
    return null;
  }
}

const findShape = db.prepare<[string, string]>(
  `SELECT shape_id, shape FROM shapes WHERE room_id = ? AND shape_id = ?`,
);

const findRoomShapes = db.prepare<[string]>(
  `SELECT shape_id, shape FROM shapes WHERE room_id = ?`,
);

const findCreatedEvent = db.prepare<[string, string]>(
  `SELECT author_name, author_role, at FROM events
     WHERE room_id = ? AND node_id = ? AND operation = 'created'
     ORDER BY seq ASC LIMIT 1`,
);

const findRoom = db.prepare<[string]>(
  `SELECT name FROM rooms WHERE room_id = ?`,
);

const findParticipants = db.prepare<[string]>(
  `SELECT u.display, m.role FROM room_members m
     JOIN users u ON u.user_id = m.user_id
     WHERE m.room_id = ?`,
);

function buildTaskInfo(
  shape: ParsedShape,
  fallback: { authorName: string; authorRole: string; createdAt: string } | null,
): TaskInfo {
  const meta = shape.meta ?? {};
  const authorName =
    (typeof meta.authorName === "string" && meta.authorName) ||
    fallback?.authorName ||
    "Unknown";
  const authorRole =
    (typeof meta.authorRole === "string" && meta.authorRole) ||
    fallback?.authorRole ||
    "Contributor";
  const createdAt =
    (typeof meta.createdAt === "string" && meta.createdAt) ||
    fallback?.createdAt ||
    new Date().toISOString();
  const intent = (typeof meta.intent === "string" && meta.intent) || "reference";

  return {
    id: shape.id,
    text: shapeText(shape),
    intent,
    authorName,
    authorRole,
    createdAt,
    position: {
      x: typeof shape.x === "number" ? shape.x : 0,
      y: typeof shape.y === "number" ? shape.y : 0,
    },
  };
}

export interface ExtractOptions {
  proximityRadius?: number;
  maxRelated?: number;
}

export async function extractTaskContext(
  taskId: string,
  roomId: string,
  options: ExtractOptions = {},
): Promise<TaskContext> {
  const proximityRadius = options.proximityRadius ?? 500;
  const maxRelated = options.maxRelated ?? 10;

  const shapeRow = findShape.get(roomId, taskId) as ShapeRow | undefined;
  if (!shapeRow) {
    throw new Error(`Task ${taskId} not found in room ${roomId}`);
  }

  const taskShape = parseShape(shapeRow.shape);
  if (!taskShape) {
    throw new Error(`Task ${taskId} could not be parsed`);
  }

  const event = findCreatedEvent.get(roomId, taskId) as EventRow | undefined;
  const fallback = event
    ? {
        authorName: event.author_name,
        authorRole: event.author_role,
        createdAt: event.at,
      }
    : null;

  const task = buildTaskInfo(taskShape, fallback);

  // Find related tasks: every other shape within proximity radius.
  const allRows = findRoomShapes.all(roomId) as ShapeRow[];
  const relatedTasks: TaskInfo[] = [];
  for (const row of allRows) {
    if (row.shape_id === taskId) continue;
    const s = parseShape(row.shape);
    if (!s) continue;
    const sx = typeof s.x === "number" ? s.x : 0;
    const sy = typeof s.y === "number" ? s.y : 0;
    const dx = sx - task.position.x;
    const dy = sy - task.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > proximityRadius) continue;
    const text = shapeText(s);
    if (!text) continue; // skip shapes with no text
    const ev = findCreatedEvent.get(roomId, s.id) as EventRow | undefined;
    relatedTasks.push(
      buildTaskInfo(
        s,
        ev
          ? {
              authorName: ev.author_name,
              authorRole: ev.author_role,
              createdAt: ev.at,
            }
          : null,
      ),
    );
  }
  relatedTasks.sort((a, b) => {
    const da =
      (a.position.x - task.position.x) ** 2 + (a.position.y - task.position.y) ** 2;
    const db_ =
      (b.position.x - task.position.x) ** 2 + (b.position.y - task.position.y) ** 2;
    return da - db_;
  });
  const trimmed = relatedTasks.slice(0, maxRelated);

  const room = (findRoom.get(roomId) as RoomRow | undefined) ?? { name: roomId };
  const participants = (findParticipants.all(roomId) as ParticipantRow[]).map((p) => ({
    name: p.display,
    role: p.role,
  }));

  return {
    task,
    relatedTasks: trimmed,
    roomParticipants: participants,
    roomName: room.name,
  };
}

/** Convenience: just resolve participants without loading a task. */
export function findRelatedTasks(
  taskId: string,
  roomId: string,
  proximityRadius = 500,
  maxRelated = 10,
): TaskInfo[] {
  try {
    const ctx = extractTaskContextSync(taskId, roomId, { proximityRadius, maxRelated });
    return ctx.relatedTasks;
  } catch {
    return [];
  }
}

function extractTaskContextSync(
  taskId: string,
  roomId: string,
  options: ExtractOptions,
): TaskContext {
  // Same logic, but synchronous (better-sqlite3 is sync anyway).
  const proximityRadius = options.proximityRadius ?? 500;
  const maxRelated = options.maxRelated ?? 10;

  const shapeRow = findShape.get(roomId, taskId) as ShapeRow | undefined;
  if (!shapeRow) throw new Error(`Task ${taskId} not found in room ${roomId}`);
  const taskShape = parseShape(shapeRow.shape);
  if (!taskShape) throw new Error(`Task ${taskId} could not be parsed`);
  const event = findCreatedEvent.get(roomId, taskId) as EventRow | undefined;
  const fallback = event
    ? {
        authorName: event.author_name,
        authorRole: event.author_role,
        createdAt: event.at,
      }
    : null;
  const task = buildTaskInfo(taskShape, fallback);

  const allRows = findRoomShapes.all(roomId) as ShapeRow[];
  const relatedTasks: TaskInfo[] = [];
  for (const row of allRows) {
    if (row.shape_id === taskId) continue;
    const s = parseShape(row.shape);
    if (!s) continue;
    const sx = typeof s.x === "number" ? s.x : 0;
    const sy = typeof s.y === "number" ? s.y : 0;
    const dx = sx - task.position.x;
    const dy = sy - task.position.y;
    if (Math.sqrt(dx * dx + dy * dy) > proximityRadius) continue;
    if (!shapeText(s)) continue;
    const ev = findCreatedEvent.get(roomId, s.id) as EventRow | undefined;
    relatedTasks.push(
      buildTaskInfo(
        s,
        ev
          ? { authorName: ev.author_name, authorRole: ev.author_role, createdAt: ev.at }
          : null,
      ),
    );
  }
  const trimmed = relatedTasks.slice(0, maxRelated);
  const room = (findRoom.get(roomId) as RoomRow | undefined) ?? { name: roomId };
  const participants = (findParticipants.all(roomId) as ParticipantRow[]).map((p) => ({
    name: p.display,
    role: p.role,
  }));
  return { task, relatedTasks: trimmed, roomParticipants: participants, roomName: room.name };
}
