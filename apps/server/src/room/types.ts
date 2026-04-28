/**
 * His protocol types. Mirrors the contract in backend/INTEGRATION.md and the
 * shapes already produced by his frontend's parseSocketMessage.
 */
export type Role = "Lead" | "Contributor" | "Viewer";

export interface TLShape {
  id: string;
  typeName: "shape";
  type?: string;
  meta?: Record<string, unknown> & {
    ligma?: {
      authorId?: string;
      authorName?: string;
      authorRole?: Role;
      authorColorIndex?: number;
      createdAt?: string;
      lockedToRoles?: Role[];
    };
  };
  [k: string]: unknown;
}

export interface SyncDelta {
  added: Record<string, TLShape>;
  updated: Record<string, [TLShape, TLShape] | TLShape>;
  removed: Record<string, TLShape>;
}

export interface CanvasEvent {
  id: string;
  seq: number;
  at: string;
  label: string;
  nodeId?: string;
  operation: "created" | "updated" | "deleted";
  source: "user" | "remote";
  authorName: string;
  authorRole: Role;
}

export type WsClientMsg =
  | {
      type: "hello";
      roomId: string;
      sessionId: string;
      name: string;
      color: string;
      role: Role;
      lastEventSeq: number;
    }
  | { type: "canvas-delta"; delta: SyncDelta }
  | { type: "presence-cursor"; x: number; y: number }
  | { type: "yjs-update"; update: number[] };

export type WsServerMsg =
  | {
      type: "sync-welcome";
      roomId: string;
      serverTime: number;
      senderSessionId: "server";
      shapes: TLShape[];
      events: CanvasEvent[];
      taskUpdate: number[];
      users: Array<{ sessionId: string; name: string; color: string; role: Role }>;
    }
  | {
      type: "canvas-delta";
      roomId: string;
      senderSessionId: string;
      delta: SyncDelta;
      events: CanvasEvent[];
    }
  | { type: "mutation-rejected"; roomId: string; rejected: Array<{ id: string; reason: string }> }
  | {
      type: "presence-cursor";
      sessionId: string;
      name: string;
      color: string;
      role: Role;
      x: number;
      y: number;
    }
  | {
      type: "presence-user";
      phase: "join" | "leave";
      sessionId: string;
      name?: string;
      color?: string;
      role?: Role;
    }
  | { type: "yjs-update"; roomId: string; senderSessionId: string; update: number[] };
