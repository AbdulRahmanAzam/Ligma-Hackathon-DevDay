import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { v4 as uuid } from "uuid";
import {
  type WsClientToServer,
  type WsServerToClient,
  type Role,
  EventKind,
} from "@ligma/shared";
import { verifyToken } from "../api/auth.js";
import { effectiveRole, invalidateUser } from "../rbac/role-cache.js";
import { authorize } from "../rbac/authorize.js";
import { append, fetchSince, maxLamport, maxSeq } from "../events/writer.js";
import { maybeSnapshot } from "../events/snapshot.js";
import { recordDenial } from "../api/hud.js";
import { project as projectNodes } from "../projections/nodes-index.js";
import { project as projectTasks } from "../projections/task-board.js";
import {
  broadcast,
  broadcastEvent,
  join,
  leave,
  type ClientSession,
} from "../room/room-registry.js";

const RATE_LIMIT_OPS_PER_SEC = 200;
const HIGHWATER_BYTES = 4 * 1024 * 1024;

export function attachWs(httpServer: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    const room = url.searchParams.get("room");
    const token = url.searchParams.get("token");
    if (!room || !token) {
      socket.destroy();
      return;
    }
    const claims = await verifyToken(token);
    if (!claims) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      onConnection(ws, room, claims.sub, claims.display, claims.email);
    });
  });
}

function send(ws: WebSocket, msg: WsServerToClient): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function onConnection(
  ws: WebSocket,
  roomId: string,
  userId: string,
  display: string,
  email: string,
): void {
  const role = effectiveRole(userId, roomId, null) ?? "viewer";

  const session: ClientSession = {
    user_id: userId,
    display,
    email,
    role: role as Role,
    room_id: roomId,
    ws,
    last_applied_seq: 0,
    out_queue_bytes: 0,
  };

  let helloDone = false;
  const opTimestamps: number[] = [];
  let aliveTimer: NodeJS.Timeout | null = null;

  const heartbeat = () => {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  };
  aliveTimer = setInterval(heartbeat, 25_000);

  ws.on("message", (raw) => {
    let msg: WsClientToServer;
    try {
      msg = JSON.parse(String(raw)) as WsClientToServer;
    } catch {
      return;
    }

    if (msg.t === "ping") {
      send(ws, { t: "pong" });
      return;
    }

    if (msg.t === "hello") {
      if (helloDone) return;
      helloDone = true;
      session.last_applied_seq = msg.last_applied_seq;

      send(ws, {
        t: "hello_ok",
        room: roomId,
        user_id: userId,
        role: session.role,
        lamport_max: maxLamport(roomId),
        seq_max: maxSeq(roomId),
      });

      // Replay any missed events.
      const missed = fetchSince(roomId, msg.last_applied_seq);
      if (missed.length > 0) {
        send(ws, { t: "snapshot_response", upto: maxSeq(roomId), tail: missed });
      }

      join(session);
      return;
    }

    if (!helloDone) return;

    if (msg.t === "presence") {
      broadcast(
        roomId,
        {
          t: "presence",
          user_id: userId,
          cursor: msg.cursor,
          selection: msg.selection,
          viewport: msg.viewport,
        },
        session,
      );
      return;
    }

    if (msg.t === "snapshot_request") {
      const tail = fetchSince(roomId, msg.since);
      send(ws, { t: "snapshot_response", upto: maxSeq(roomId), tail });
      return;
    }

    if (msg.t === "op") {
      const now = Date.now();
      // Rate limit: 200 ops/sec, sliding 1s window.
      while (opTimestamps.length > 0 && opTimestamps[0]! < now - 1000) {
        opTimestamps.shift();
      }
      if (opTimestamps.length >= RATE_LIMIT_OPS_PER_SEC) {
        send(ws, { t: "rate_limited", ref_id: msg.id });
        return;
      }
      opTimestamps.push(now);

      // Ring 2 RBAC.
      const auth = authorize(userId, roomId, msg.node_id, msg.kind);
      if (!auth.ok) {
        recordDenial(roomId, userId, msg.kind, auth.reason);
        send(ws, {
          t: "rbac_denied",
          ref_id: msg.id,
          reason: auth.reason,
          kind: msg.kind,
        });
        return;
      }

      const result = append({
        room_id: roomId,
        actor_id: userId,
        node_id: msg.node_id,
        kind: msg.kind,
        payload: msg.payload,
        client_lamport: msg.lamport,
        client_ts: msg.client_ts,
        causation_id: msg.causation_id ?? null,
        client_msg_id: msg.id,
      });

      if (!result.ok) {
        // Ring 3 (SQL trigger) rejected it, or insert failed.
        recordDenial(roomId, userId, msg.kind, result.reason);
        send(ws, {
          t: "rbac_denied",
          ref_id: msg.id,
          reason: result.reason,
          kind: msg.kind,
        });
        return;
      }

      // Drive projections in-process. Order: nodes-index first (RBAC-relevant),
      // then task board (visible to clients).
      projectNodes(result.event);
      projectTasks(result.event);

      // Cache invalidation: any permission change purges role-cache for the user.
      if (
        msg.kind === EventKind.PERMISSION_GRANTED ||
        msg.kind === EventKind.PERMISSION_REVOKED
      ) {
        const p = msg.payload as { user_id?: string };
        if (p?.user_id) {
          invalidateUser(p.user_id);
          broadcast(roomId, {
            t: "role_changed",
            user_id: p.user_id,
            node_id: msg.node_id,
            new_role:
              msg.kind === EventKind.PERMISSION_GRANTED
                ? ((msg.payload as { role: Role }).role as Role)
                : ("viewer" as Role),
            seq: result.event.seq,
          });
        }
      }

      // Ack the originator with seq + lamport.
      send(ws, {
        t: "ack",
        ref_id: msg.id,
        seq: result.event.seq,
        lamport: result.event.lamport,
      });

      // Broadcast to everyone (including originator — convenient for HUD).
      broadcastEvent(roomId, result.event);

      maybeSnapshot(roomId);
    }
  });

  ws.on("close", () => {
    if (aliveTimer) clearInterval(aliveTimer);
    leave(session);
  });

  ws.on("error", () => {
    if (aliveTimer) clearInterval(aliveTimer);
    leave(session);
  });
}

// Suppress unused-import warning under noUnusedParameters.
void HIGHWATER_BYTES;
void uuid;
