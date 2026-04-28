import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import * as Y from "yjs";
import { v4 as uuid } from "uuid";
import { verifyToken } from "../api/auth.js";
import { getRoleInRoom } from "../api/auth.js";
import {
  activeUserList,
  broadcast,
  getEventsSince,
  getRoom,
  getShapesSnapshot,
  joinRoom,
  leaveRoom,
  persistTaskDoc,
  send,
  type ClientSession,
} from "../room/registry.js";
import { validateAndApplyDelta } from "../room/delta.js";
import type { Role, WsClientMsg } from "../room/types.js";

export function attachWs(httpServer: Server, path = "/ligma-sync"): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== path) {
      socket.destroy();
      return;
    }
    const token = url.searchParams.get("token");
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
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
      onConnection(ws, claims.sub, claims.display);
    });
  });
}

function parse(raw: unknown): WsClientMsg | null {
  try {
    const v = JSON.parse(String(raw)) as Record<string, unknown>;
    if (!v || typeof v.type !== "string") return null;
    return v as unknown as WsClientMsg;
  } catch {
    return null;
  }
}

function sanitizeRole(v: unknown): Role {
  return v === "Lead" || v === "Contributor" || v === "Viewer" ? v : "Viewer";
}

function onConnection(ws: WebSocket, userId: string, displayName: string): void {
  let roomId = "";
  let session: ClientSession | null = null;
  let aliveTimer: NodeJS.Timeout | null = null;

  // 25s WS-level keepalive.
  aliveTimer = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }, 25_000);

  ws.on("message", (raw) => {
    const msg = parse(raw);
    if (!msg) return;

    if (msg.type === "hello") {
      // The client claims a role in `hello`, but we trust *our* server-side
      // assignment from room_members / default_role. The client's role string
      // is informational only.
      roomId = String(msg.roomId || "ligma-devday-main");
      const serverRole = getRoleInRoom(userId, roomId) ?? "Viewer";
      const clientRole = sanitizeRole(msg.role);

      session = {
        user_id: userId,
        sessionId: msg.sessionId || uuid(),
        name: msg.name?.slice(0, 80) || displayName || "Anonymous",
        color: msg.color || "#0ea5e9",
        // Use whichever is *more restrictive* between server-assigned and
        // client-claimed. In practice this means: client can self-demote
        // (e.g. "view-as Viewer") but cannot self-elevate.
        role: roleMin(serverRole, clientRole),
        socket: ws,
      };

      const room = joinRoom(roomId, session);

      send(ws, {
        type: "sync-welcome",
        roomId,
        serverTime: Date.now(),
        senderSessionId: "server",
        shapes: getShapesSnapshot(roomId),
        events: getEventsSince(roomId, Number(msg.lastEventSeq ?? 0)),
        taskUpdate: Array.from(Y.encodeStateAsUpdate(room.taskDoc)),
        users: activeUserList(roomId),
      });

      broadcast(
        roomId,
        {
          type: "presence-user",
          phase: "join",
          sessionId: session.sessionId,
          name: session.name,
          color: session.color,
          role: session.role,
        },
        session.sessionId,
      );
      return;
    }

    if (!session) return;

    if (msg.type === "canvas-delta") {
      const { acceptedDelta, events, rejected } = validateAndApplyDelta(
        roomId,
        { name: session.name, role: session.role },
        msg.delta,
      );

      if (events.length > 0) {
        broadcast(roomId, {
          type: "canvas-delta",
          roomId,
          senderSessionId: session.sessionId,
          delta: acceptedDelta,
          events,
        });
      }
      if (rejected.length > 0) {
        send(ws, { type: "mutation-rejected", roomId, rejected });
      }
      return;
    }

    if (msg.type === "presence-cursor") {
      broadcast(
        roomId,
        {
          type: "presence-cursor",
          sessionId: session.sessionId,
          name: session.name,
          color: session.color,
          role: session.role,
          x: Number(msg.x) || 0,
          y: Number(msg.y) || 0,
        },
        session.sessionId,
      );
      return;
    }

    if (msg.type === "yjs-update" && Array.isArray(msg.update)) {
      const room = getRoom(roomId);
      if (!room) return;
      try {
        Y.applyUpdate(room.taskDoc, Uint8Array.from(msg.update), session.sessionId);
        // Persist on every update — small cost, and keeps the doc safe across
        // restarts. For higher traffic we'd debounce; MVP is fine.
        persistTaskDoc(roomId, room.taskDoc);
      } catch (err) {
        console.warn(`[ws] bad yjs update from ${session.sessionId}:`, err);
        return;
      }
      broadcast(
        roomId,
        {
          type: "yjs-update",
          roomId,
          senderSessionId: session.sessionId,
          update: msg.update,
        },
        session.sessionId,
      );
      return;
    }
  });

  ws.on("close", () => {
    if (aliveTimer) clearInterval(aliveTimer);
    if (session) {
      const sid = session.sessionId;
      leaveRoom(roomId, sid);
      broadcast(roomId, { type: "presence-user", phase: "leave", sessionId: sid });
    }
  });

  ws.on("error", () => {
    if (aliveTimer) clearInterval(aliveTimer);
    if (session) {
      const sid = session.sessionId;
      leaveRoom(roomId, sid);
      broadcast(roomId, { type: "presence-user", phase: "leave", sessionId: sid });
    }
  });
}

function roleMin(a: Role, b: Role): Role {
  // Lead > Contributor > Viewer (in privilege).
  const rank = { Lead: 3, Contributor: 2, Viewer: 1 };
  return rank[a] < rank[b] ? a : b;
}
