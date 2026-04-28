import type { WebSocket } from "ws";
import type { BaseEvent, Role } from "@ligma/shared";

export interface ClientSession {
  user_id: string;
  display: string;
  email: string;
  role: Role; // Room-default role at connect time (Ring 1 hint, NOT trusted server-side)
  room_id: string;
  ws: WebSocket;
  last_applied_seq: number;
  out_queue_bytes: number;
}

const rooms = new Map<string, Set<ClientSession>>();

export function join(session: ClientSession): void {
  let s = rooms.get(session.room_id);
  if (!s) {
    s = new Set();
    rooms.set(session.room_id, s);
  }
  s.add(session);
}

export function leave(session: ClientSession): void {
  const s = rooms.get(session.room_id);
  if (!s) return;
  s.delete(session);
  if (s.size === 0) rooms.delete(session.room_id);
}

export function broadcast(
  roomId: string,
  payload: object,
  except?: ClientSession,
): void {
  const s = rooms.get(roomId);
  if (!s) return;
  const data = JSON.stringify(payload);
  for (const c of s) {
    if (c === except) continue;
    if (c.ws.readyState !== c.ws.OPEN) continue;
    try {
      c.ws.send(data);
    } catch {
      /* client dead, gateway will reap on close */
    }
  }
}

export function broadcastEvent(roomId: string, event: BaseEvent): void {
  broadcast(roomId, { t: "op", event });
}

export function roomCount(): number {
  return rooms.size;
}

export function membersOf(roomId: string): ClientSession[] {
  return Array.from(rooms.get(roomId) ?? []);
}
