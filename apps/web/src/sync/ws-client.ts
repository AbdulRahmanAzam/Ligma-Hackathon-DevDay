import { v4 as uuid } from "uuid";
import type {
  BaseEvent,
  EventKind,
  Role,
  TaskRow,
  WsClientToServer,
  WsServerToClient,
} from "@ligma/shared";

export interface WsClientHandlers {
  onEvent(e: BaseEvent): void;
  onAck(refId: string, seq: number, lamport: number): void;
  onHello(role: Role, userId: string, lamportMax: number, seqMax: number): void;
  onPresence(userId: string, cursor: { x: number; y: number }): void;
  onRoleChanged(userId: string, nodeId: string | null, newRole: Role): void;
  onRbacDenied(refId: string, reason: string, kind: EventKind): void;
  onTaskUpserted(task: TaskRow): void;
  onConnectionState(s: "connecting" | "open" | "closed"): void;
}

interface PendingOp {
  msg: WsClientToServer & { t: "op" };
  retries: number;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private room: string;
  private lamport = 0;
  private lastAppliedSeq = 0;
  private outQueue: PendingOp[] = [];
  private inflight = new Map<string, PendingOp>();
  private reconnectTimer: number | null = null;
  private closed = false;

  constructor(
    url: string,
    token: string,
    room: string,
    private handlers: WsClientHandlers,
  ) {
    this.url = url;
    this.token = token;
    this.room = room;
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private connect(): void {
    this.handlers.onConnectionState("connecting");
    const u = new URL(this.url);
    u.searchParams.set("room", this.room);
    u.searchParams.set("token", this.token);

    const ws = new WebSocket(u.toString());
    this.ws = ws;

    ws.onopen = () => {
      const hello: WsClientToServer = {
        t: "hello",
        id: uuid(),
        room: this.room,
        last_applied_seq: this.lastAppliedSeq,
      };
      ws.send(JSON.stringify(hello));
    };

    ws.onmessage = (evt) => {
      const msg = JSON.parse(String(evt.data)) as WsServerToClient;
      this.dispatch(msg);
    };

    ws.onclose = () => {
      this.handlers.onConnectionState("closed");
      if (this.closed) return;
      // schedule reconnect
      this.reconnectTimer = window.setTimeout(() => this.connect(), 800);
    };

    ws.onerror = () => {
      // Let onclose handle the reconnect.
    };
  }

  private dispatch(msg: WsServerToClient): void {
    switch (msg.t) {
      case "hello_ok":
        this.lamport = Math.max(this.lamport, msg.lamport_max);
        this.handlers.onHello(msg.role, msg.user_id, msg.lamport_max, msg.seq_max);
        this.handlers.onConnectionState("open");
        // Drain any queued ops now that we have a fresh socket.
        for (const p of this.outQueue) this.sendRaw(p.msg);
        return;

      case "ack": {
        const pending = this.inflight.get(msg.ref_id);
        if (pending) this.inflight.delete(msg.ref_id);
        this.lamport = Math.max(this.lamport, msg.lamport);
        this.handlers.onAck(msg.ref_id, msg.seq, msg.lamport);
        return;
      }

      case "op":
        this.lamport = Math.max(this.lamport, msg.event.lamport);
        this.lastAppliedSeq = Math.max(this.lastAppliedSeq, msg.event.seq);
        this.handlers.onEvent(msg.event);
        return;

      case "snapshot_response":
        for (const e of msg.tail) {
          this.lamport = Math.max(this.lamport, e.lamport);
          this.lastAppliedSeq = Math.max(this.lastAppliedSeq, e.seq);
          this.handlers.onEvent(e);
        }
        return;

      case "presence":
        this.handlers.onPresence(msg.user_id, msg.cursor);
        return;

      case "role_changed":
        this.handlers.onRoleChanged(msg.user_id, msg.node_id, msg.new_role);
        return;

      case "rbac_denied":
        this.handlers.onRbacDenied(msg.ref_id, msg.reason, msg.kind);
        return;

      case "task_upserted":
        this.handlers.onTaskUpserted(msg.task);
        return;

      default:
        return;
    }
  }

  private sendRaw(msg: WsClientToServer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  emitOp(kind: EventKind, nodeId: string | null, payload: unknown, causation?: string): string {
    this.lamport += 1;
    const id = uuid();
    const msg: WsClientToServer & { t: "op" } = {
      t: "op",
      id,
      kind,
      node_id: nodeId,
      payload,
      lamport: this.lamport,
      client_ts: Date.now(),
      causation_id: causation ?? null,
    };
    const pending: PendingOp = { msg, retries: 0 };
    this.inflight.set(id, pending);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendRaw(msg);
    } else {
      this.outQueue.push(pending);
    }
    return id;
  }

  presence(cursor: { x: number; y: number }, selection?: string[]): void {
    this.sendRaw({ t: "presence", cursor, selection });
  }
}
