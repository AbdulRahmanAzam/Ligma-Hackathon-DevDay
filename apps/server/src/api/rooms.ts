import type { FastifyInstance } from "fastify";
import { v4 as uuid } from "uuid";
import { db } from "../db/sqlite.js";
import { verifyToken } from "./auth.js";
import { fetchSince, maxSeq } from "../events/writer.js";
import { listForRoom } from "../projections/task-board.js";
import type { RoomMeta, Role } from "@ligma/shared";

async function requireAuth(req: { headers: Record<string, unknown> }) {
  const auth = req.headers["authorization"];
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  return verifyToken(token);
}

export function registerRoomRoutes(app: FastifyInstance): void {
  app.get("/api/rooms", async (req, reply) => {
    const claims = await requireAuth(req);
    if (!claims) return reply.code(401).send({ error: "unauthorized" });

    const rows = db
      .prepare(
        `SELECT r.room_id, r.name, r.owner_id, r.default_role, r.created_at
         FROM rooms r
         LEFT JOIN room_members m ON m.room_id = r.room_id AND m.user_id = ?
         WHERE r.archived_at IS NULL AND (r.owner_id = ? OR m.user_id IS NOT NULL)
         ORDER BY r.created_at DESC`,
      )
      .all(claims.sub, claims.sub) as RoomMeta[];
    return rows;
  });

  app.post<{ Body: { name?: string; default_role?: Role } }>(
    "/api/rooms",
    async (req, reply) => {
      const claims = await requireAuth(req);
      if (!claims) return reply.code(401).send({ error: "unauthorized" });

      const room_id = `rm_${uuid().slice(0, 8)}`;
      const name = req.body?.name ?? "Untitled room";
      const default_role: Role = req.body?.default_role ?? "contributor";
      db.prepare(
        `INSERT INTO rooms (room_id, name, owner_id, default_role) VALUES (?, ?, ?, ?)`,
      ).run(room_id, name, claims.sub, default_role);
      db.prepare(
        `INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'lead')`,
      ).run(room_id, claims.sub);

      return reply.code(201).send({ room_id, name, default_role, owner_id: claims.sub });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/rooms/:id",
    async (req, reply) => {
      const claims = await requireAuth(req);
      if (!claims) return reply.code(401).send({ error: "unauthorized" });
      const room = db
        .prepare(
          `SELECT room_id, name, owner_id, default_role, created_at
           FROM rooms WHERE room_id = ? AND archived_at IS NULL`,
        )
        .get(req.params.id) as RoomMeta | undefined;
      if (!room) return reply.code(404).send({ error: "not_found" });

      const members = db
        .prepare(
          `SELECT m.user_id, m.role, u.display, u.email FROM room_members m
           JOIN users u ON u.user_id = m.user_id WHERE m.room_id = ?`,
        )
        .all(req.params.id);
      return { ...room, members };
    },
  );

  app.post<{
    Params: { id: string };
    Body: { user_id: string; role: Role; node_id?: string };
  }>("/api/rooms/:id/permissions", async (req, reply) => {
    const claims = await requireAuth(req);
    if (!claims) return reply.code(401).send({ error: "unauthorized" });

    const ownerCheck = db
      .prepare(`SELECT role FROM room_members WHERE room_id = ? AND user_id = ?`)
      .get(req.params.id, claims.sub) as { role: Role } | undefined;
    if (!ownerCheck || ownerCheck.role !== "lead") {
      return reply.code(403).send({ error: "lead_required" });
    }

    const { user_id, role, node_id } = req.body;
    if (node_id) {
      db.prepare(
        `INSERT INTO node_permissions (node_id, user_id, role, granted_by, granted_seq)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(node_id, user_id) DO UPDATE SET role = excluded.role, granted_seq = excluded.granted_seq`,
      ).run(node_id, user_id, role, claims.sub, maxSeq(req.params.id));
    } else {
      db.prepare(
        `INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)
         ON CONFLICT(room_id, user_id) DO UPDATE SET role = excluded.role`,
      ).run(req.params.id, user_id, role);
    }
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>(
    "/api/rooms/:id/snapshot",
    async (req, reply) => {
      const claims = await requireAuth(req);
      if (!claims) return reply.code(401).send({ error: "unauthorized" });
      const events = fetchSince(req.params.id, 0, 5000);
      return { upto: maxSeq(req.params.id), events };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    "/api/rooms/:id/events",
    async (req, reply) => {
      const claims = await requireAuth(req);
      if (!claims) return reply.code(401).send({ error: "unauthorized" });
      const from = Number(req.query.from ?? 0);
      const to = Number(req.query.to ?? Number.MAX_SAFE_INTEGER);
      const events = fetchSince(req.params.id, from, 5000).filter((e) => e.seq <= to);
      return { from, to, events };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/rooms/:id/tasks",
    async (req, reply) => {
      const claims = await requireAuth(req);
      if (!claims) return reply.code(401).send({ error: "unauthorized" });
      return listForRoom(req.params.id);
    },
  );
}
