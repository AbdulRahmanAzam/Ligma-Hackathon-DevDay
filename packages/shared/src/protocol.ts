import type { BaseEvent, EventKind } from "./events.js";
import type { Role } from "./rbac.js";

export type WsClientToServer =
  | { t: "hello"; id: string; room: string; last_applied_seq: number }
  | {
      t: "op";
      id: string;
      kind: EventKind;
      node_id: string | null;
      payload: unknown;
      lamport: number;
      client_ts: number;
      causation_id?: string | null;
    }
  | {
      t: "presence";
      cursor: { x: number; y: number };
      selection?: string[];
      viewport?: { x: number; y: number; w: number; h: number };
    }
  | { t: "snapshot_request"; since: number }
  | { t: "ping" };

export type WsServerToClient =
  | {
      t: "hello_ok";
      room: string;
      user_id: string;
      role: Role;
      lamport_max: number;
      seq_max: number;
    }
  | { t: "ack"; ref_id: string; seq: number; lamport: number }
  | { t: "op"; event: BaseEvent }
  | {
      t: "presence";
      user_id: string;
      cursor: { x: number; y: number };
      selection?: string[];
      viewport?: { x: number; y: number; w: number; h: number };
    }
  | {
      t: "role_changed";
      user_id: string;
      node_id: string | null;
      new_role: Role;
      seq: number;
    }
  | {
      t: "rbac_denied";
      ref_id: string;
      reason: string;
      kind: EventKind;
    }
  | { t: "rate_limited"; ref_id: string }
  | { t: "snapshot_response"; upto: number; tail: BaseEvent[] }
  | { t: "task_upserted"; task: TaskRow }
  | { t: "pong" };

export interface TaskRow {
  task_id: string;
  room_id: string;
  source_node: string;
  title: string;
  status: "open" | "in_progress" | "done";
  ai_score: number;
  created_seq: number;
  updated_seq: number;
}

export interface AuthMeResponse {
  user_id: string;
  email: string;
  display: string;
}

export interface DevTokenRequest {
  user_id: string;
}

export interface DevTokenResponse {
  token: string;
  user_id: string;
  display: string;
  email: string;
}

export interface RoomMeta {
  room_id: string;
  name: string;
  owner_id: string;
  default_role: Role;
  created_at: number;
}
