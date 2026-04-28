import type { FastifyInstance } from "fastify";
import { db } from "../db/sqlite.js";
import { verifyToken } from "./auth.js";
import { fetchSince, maxLamport, maxSeq } from "../events/writer.js";

async function requireAuth(req: { headers: Record<string, unknown> }) {
  const auth = req.headers["authorization"];
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  return verifyToken(token);
}

const denialBuffer = new Map<string, Array<{ at: number; reason: string; user_id: string; kind: string }>>();
const DENIAL_KEEP = 50;

export function recordDenial(
  roomId: string,
  userId: string,
  kind: string,
  reason: string,
): void {
  let buf = denialBuffer.get(roomId);
  if (!buf) {
    buf = [];
    denialBuffer.set(roomId, buf);
  }
  buf.push({ at: Date.now(), reason, user_id: userId, kind });
  if (buf.length > DENIAL_KEEP) buf.shift();
}

export function registerHudRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { room?: string; tail?: string } }>(
    "/api/hud/events",
    async (req, reply) => {
      const claims = await requireAuth(req);
      if (!claims) return reply.code(401).send({ error: "unauthorized" });
      const room = req.query.room;
      const tail = Number(req.query.tail ?? 50);
      if (!room) return reply.code(400).send({ error: "room_required" });
      const upto = maxSeq(room);
      const from = Math.max(0, upto - tail);
      return { upto, events: fetchSince(room, from, tail) };
    },
  );

  app.get<{ Querystring: { room?: string } }>(
    "/api/hud/denials",
    async (req, reply) => {
      const claims = await requireAuth(req);
      if (!claims) return reply.code(401).send({ error: "unauthorized" });
      const room = req.query.room;
      if (!room) return reply.code(400).send({ error: "room_required" });
      return { denials: denialBuffer.get(room) ?? [] };
    },
  );

  app.get<{ Querystring: { room?: string } }>(
    "/api/hud/state-vector",
    async (req, reply) => {
      const claims = await requireAuth(req);
      if (!claims) return reply.code(401).send({ error: "unauthorized" });
      const room = req.query.room;
      if (!room) return reply.code(400).send({ error: "room_required" });
      return { lamport: maxLamport(room), seq: maxSeq(room) };
    },
  );
}

void db;
