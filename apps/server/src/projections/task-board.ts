import { db } from "../db/sqlite.js";
import { EventKind, type BaseEvent, type TaskRow } from "@ligma/shared";

const upsertTask = db.prepare(`
  INSERT INTO tasks (task_id, room_id, source_node, title, status, ai_score, created_seq, updated_seq)
  VALUES (?, ?, ?, ?, 'open', ?, ?, ?)
  ON CONFLICT(task_id) DO UPDATE SET
    title = excluded.title,
    ai_score = excluded.ai_score,
    updated_seq = excluded.updated_seq
`);

const updateStatus = db.prepare(`
  UPDATE tasks SET status = ?, updated_seq = ? WHERE task_id = ?
`);

const deleteFromNode = db.prepare(`DELETE FROM tasks WHERE source_node = ?`);

const fetchTask = db.prepare(`
  SELECT task_id, room_id, source_node, title, status, ai_score, created_seq, updated_seq
  FROM tasks WHERE task_id = ?
`);

const lookupNodeText = db.prepare(`
  SELECT payload FROM events
  WHERE node_id = ? AND kind IN ('node.created','sticky.text.delta')
  ORDER BY seq DESC LIMIT 1
`);

export interface TaskBoardEvent {
  type: "upsert" | "delete";
  room_id: string;
  task: TaskRow | null;
  source_node: string;
}

type Subscriber = (e: TaskBoardEvent) => void;
const subs = new Set<Subscriber>();

export function subscribe(fn: Subscriber): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

function emit(e: TaskBoardEvent): void {
  for (const s of subs) s(e);
}

function extractTitleFromNode(nodeId: string, fallback: string): string {
  const row = lookupNodeText.get(nodeId) as { payload: string } | undefined;
  if (!row) return fallback;
  try {
    const p = JSON.parse(row.payload) as { text?: string };
    if (typeof p.text === "string" && p.text.trim()) return p.text.trim().slice(0, 120);
  } catch {
    /* ignore */
  }
  return fallback;
}

export function project(e: BaseEvent): void {
  if (
    e.kind === EventKind.INTENT_LABELED &&
    e.node_id &&
    typeof (e.payload as { label?: string }).label === "string" &&
    (e.payload as { label: string }).label === "action item"
  ) {
    const p = e.payload as { label: string; score: number };
    const taskId = `task_${e.node_id}`;
    const title = extractTitleFromNode(e.node_id, "(action item)");
    upsertTask.run(
      taskId,
      e.room_id,
      e.node_id,
      title,
      p.score,
      e.seq,
      e.seq,
    );
    const task = fetchTask.get(taskId) as TaskRow;
    emit({ type: "upsert", room_id: e.room_id, task, source_node: e.node_id });
    return;
  }

  if (e.kind === EventKind.TASK_STATUS_SET) {
    const p = e.payload as { task_id: string; status: "open" | "in_progress" | "done" };
    updateStatus.run(p.status, e.seq, p.task_id);
    const task = fetchTask.get(p.task_id) as TaskRow | undefined;
    if (task) {
      emit({
        type: "upsert",
        room_id: e.room_id,
        task,
        source_node: task.source_node,
      });
    }
    return;
  }

  if (e.kind === EventKind.NODE_DELETED && e.node_id) {
    deleteFromNode.run(e.node_id);
    emit({ type: "delete", room_id: e.room_id, task: null, source_node: e.node_id });
  }
}

export function listForRoom(roomId: string): TaskRow[] {
  return db
    .prepare(
      `SELECT task_id, room_id, source_node, title, status, ai_score, created_seq, updated_seq
       FROM tasks WHERE room_id = ? ORDER BY updated_seq DESC`,
    )
    .all(roomId) as TaskRow[];
}
