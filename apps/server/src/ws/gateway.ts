// ---------------------------------------------------------------------------
// WebSocket Gateway — Custom WS Protocol
// We use a custom WebSocket protocol layered on top of tldraw's native
// collaboration rather than relying on tldraw's built-in sync. This enables:
//   1. Server-side RBAC enforcement — mutations are validated per-role
//   2. Immutable event logging — every accepted delta is persisted for audit
//   3. Audit trail & replay — the event log enables timeline scrubbing
//   4. Selective broadcast — e.g. cursor-leave on disconnect, presence, etc.
// ---------------------------------------------------------------------------

import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import * as Y from "yjs";
import { v4 as uuid } from "uuid";
import { verifyToken } from "../api/auth.js";
import { getRoleInRoom, resolveInviteToken } from "../api/auth.js";
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
    const invite = url.searchParams.get("invite");

    if (token) {
      const claims = await verifyToken(token);
      if (!claims) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        onConnection(ws, {
          kind: "user",
          userId: claims.sub,
          displayName: claims.display,
        });
      });
      return;
    }

    if (invite) {
      const resolved = resolveInviteToken(invite);
      // Anonymous WS access is only for read-only viewer invites. Contributor
      // invites still require sign-in so we can attribute their writes.
      if (!resolved || resolved.role !== "Viewer") {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const guestId = `guest_${Math.random().toString(36).slice(2, 10)}`;
      wss.handleUpgrade(req, socket, head, (ws) => {
        onConnection(ws, {
          kind: "guest",
          userId: guestId,
          displayName: "Guest",
          forcedRole: "Viewer",
          inviteRoomId: resolved.room_id,
        });
      });
      return;
    }

    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
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

type ConnectionAuth =
  | { kind: "user"; userId: string; displayName: string }
  | {
      kind: "guest";
      userId: string;
      displayName: string;
      forcedRole: "Viewer";
      inviteRoomId: string;
    };

function onConnection(ws: WebSocket, auth: ConnectionAuth): void {
  const userId = auth.userId;
  const displayName = auth.displayName;
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
      if (auth.kind === "guest") {
        // Guests can only enter the room their invite was scoped to.
        roomId = auth.inviteRoomId;
      } else {
        roomId = String(msg.roomId || "ligma-devday-main");
      }
      const serverRole: Role =
        auth.kind === "guest"
          ? auth.forcedRole
          : getRoleInRoom(userId, roomId) ?? "Viewer";
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
        {
          name: session.name,
          role: session.role,
          sessionId: session.sessionId,
          color: session.color,
        },
        msg.delta,
        msg.cursor,
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

    if (msg.type === "role-update") {
      // Live role change: re-compute the effective role using roleMin so the
      // client can self-demote but never self-elevate past the server assignment.
      const serverRole: Role =
        auth.kind === "guest"
          ? auth.forcedRole
          : getRoleInRoom(userId, roomId) ?? "Viewer";
      const newRole = roleMin(serverRole, sanitizeRole(msg.role));
      session.role = newRole;
      if (msg.name) session.name = msg.name.slice(0, 80);
      if (msg.color) session.color = msg.color;

      // Broadcast the updated presence so all clients see the new role
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
  });

  ws.on("close", () => {
    if (aliveTimer) clearInterval(aliveTimer);
    if (session) {
      const sid = session.sessionId;
      leaveRoom(roomId, sid);
      broadcast(roomId, { type: "presence-user", phase: "leave", sessionId: sid });
      // Immediately notify remaining clients to remove the departing cursor,
      // so they don't have to wait for the 3-second client-side timeout.
      broadcast(roomId, {
        type: "presence-cursor",
        sessionId: sid,
        name: session.name,
        color: session.color,
        role: session.role,
        x: -1e9,
        y: -1e9,
      });
    }
  });

  ws.on("error", () => {
    if (aliveTimer) clearInterval(aliveTimer);
    if (session) {
      const sid = session.sessionId;
      leaveRoom(roomId, sid);
      broadcast(roomId, { type: "presence-user", phase: "leave", sessionId: sid });
      broadcast(roomId, {
        type: "presence-cursor",
        sessionId: sid,
        name: session.name,
        color: session.color,
        role: session.role,
        x: -1e9,
        y: -1e9,
      });
    }
  });
}

function roleMin(a: Role, b: Role): Role {
  // Lead > Contributor > Viewer (in privilege).
  const rank = { Lead: 3, Contributor: 2, Viewer: 1 };
  return rank[a] < rank[b] ? a : b;
}
