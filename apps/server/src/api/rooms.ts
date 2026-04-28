import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { v4 as uuid } from "uuid";
import { db } from "../db/sqlite.js";
import { verifyToken } from "./auth.js";
import { getEventsSince } from "../room/registry.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function newInviteToken(): string {
  return randomBytes(18).toString("base64url"); // 24-char url-safe
}

async function requireAuth(req: { headers: Record<string, unknown> }) {
  const auth = req.headers["authorization"];
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return null;
  return verifyToken(auth.slice(7));
}

type Role = "Lead" | "Contributor" | "Viewer";

export function registerRoomRoutes(app: FastifyInstance): void {
  app.get("/api/rooms", async (req, reply) => {
    const claims = await requireAuth(req);
    if (!claims) return reply.code(401).send({ error: "unauthorized" });
    return db
      .prepare(
        `SELECT r.room_id, r.name, r.owner_id, r.default_role, r.created_at
         FROM rooms r
         LEFT JOIN room_members m ON m.room_id = r.room_id AND m.user_id = ?
         WHERE r.archived_at IS NULL AND (r.owner_id = ? OR m.user_id IS NOT NULL)
         ORDER BY r.created_at DESC`,
      )
      .all(claims.sub, claims.sub);
  });

  app.post<{ Body: { name?: string; default_role?: Role } }>(
    "/api/rooms",
    async (req, reply) => {
      const claims = await requireAuth(req);
      if (!claims) return reply.code(401).send({ error: "unauthorized" });
      const room_id = `rm_${uuid().slice(0, 8)}`;
      const name = req.body?.name ?? "Untitled room";
      const default_role: Role = req.body?.default_role ?? "Contributor";
      db.prepare(
        `INSERT INTO rooms (room_id, name, owner_id, default_role) VALUES (?, ?, ?, ?)`,
      ).run(room_id, name, claims.sub, default_role);
      db.prepare(
        `INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'Lead')`,
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
        .get(req.params.id);
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
    Body: { user_id: string; role: Role };
  }>("/api/rooms/:id/members", async (req, reply) => {
    const claims = await requireAuth(req);
    if (!claims) return reply.code(401).send({ error: "unauthorized" });
    const ownerCheck = db
      .prepare(`SELECT role FROM room_members WHERE room_id = ? AND user_id = ?`)
      .get(req.params.id, claims.sub) as { role: Role } | undefined;
    if (!ownerCheck || ownerCheck.role !== "Lead") {
      return reply.code(403).send({ error: "lead_required" });
    }
    db.prepare(
      `INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT(room_id, user_id) DO UPDATE SET role = excluded.role`,
    ).run(req.params.id, req.body.user_id, req.body.role);
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string }; Querystring: { from?: string } }>(
    "/api/rooms/:id/events",
    async (req, reply) => {
      const claims = await requireAuth(req);
      if (!claims) return reply.code(401).send({ error: "unauthorized" });
      const from = Number(req.query.from ?? 0);
      return { from, events: getEventsSince(req.params.id, from) };
    },
  );

  // List rooms with stats for the home page.
  app.get("/api/me/rooms", async (req, reply) => {
    const claims = await requireAuth(req);
    if (!claims) return reply.code(401).send({ error: "unauthorized" });

    const rows = db
      .prepare(
        `SELECT r.room_id, r.name, r.owner_id, r.default_role, r.created_at, m.role AS my_role,
                (SELECT COUNT(*) FROM room_members WHERE room_id = r.room_id) AS member_count,
                (SELECT MAX(seq) FROM events WHERE room_id = r.room_id) AS last_seq,
                (SELECT MAX(at) FROM events WHERE room_id = r.room_id) AS last_at
         FROM rooms r
         LEFT JOIN room_members m ON m.room_id = r.room_id AND m.user_id = ?
         WHERE r.archived_at IS NULL AND (r.owner_id = ? OR m.user_id IS NOT NULL)
         ORDER BY COALESCE(last_at, '') DESC, r.created_at DESC`,
      )
      .all(claims.sub, claims.sub);
    return rows;
  });

  // Lead-only: create an invite token for this room.
  app.post<{
    Params: { id: string };
    Body: { role?: "Contributor" | "Viewer" };
  }>("/api/rooms/:id/invites", async (req, reply) => {
    const claims = await requireAuth(req);
    if (!claims) return reply.code(401).send({ error: "unauthorized" });

    const ownerCheck = db
      .prepare(`SELECT role FROM room_members WHERE room_id = ? AND user_id = ?`)
      .get(req.params.id, claims.sub) as
      | { role: "Lead" | "Contributor" | "Viewer" }
      | undefined;
    if (!ownerCheck || ownerCheck.role !== "Lead") {
      return reply.code(403).send({ error: "lead_required" });
    }

    const role = req.body?.role === "Viewer" ? "Viewer" : "Contributor";
    const token = newInviteToken();
    const now = Date.now();
    const expires = now + INVITE_TTL_MS;
    db.prepare(
      `INSERT INTO invites (token, room_id, role, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(token, req.params.id, role, claims.sub, now, expires);

    return reply.code(201).send({
      token,
      role,
      room_id: req.params.id,
      expires_at: expires,
    });
  });

  // Look up an invite (no auth required, used to render preview UI).
  app.get<{ Params: { token: string } }>(
    "/api/invites/:token",
    async (req, reply) => {
      const inv = db
        .prepare(
          `SELECT i.token, i.room_id, i.role, i.expires_at, i.revoked_at,
                  r.name AS room_name
           FROM invites i
           LEFT JOIN rooms r ON r.room_id = i.room_id
           WHERE i.token = ?`,
        )
        .get(req.params.token) as
        | {
            token: string;
            room_id: string;
            role: "Contributor" | "Viewer";
            expires_at: number;
            revoked_at: number | null;
            room_name: string;
          }
        | undefined;
      if (!inv) return reply.code(404).send({ error: "invite_not_found" });
      if (inv.revoked_at) return reply.code(410).send({ error: "invite_revoked" });
      if (Date.now() > inv.expires_at) return reply.code(410).send({ error: "invite_expired" });
      return {
        room_id: inv.room_id,
        room_name: inv.room_name,
        role: inv.role,
        expires_at: inv.expires_at,
      };
    },
  );

  // Authenticated: claim an invite token and join the room.
  app.post<{ Body: { token: string } }>("/api/invites/accept", async (req, reply) => {
    const claims = await requireAuth(req);
    if (!claims) return reply.code(401).send({ error: "unauthorized" });

    const inv = db
      .prepare(`SELECT token, room_id, role, expires_at, revoked_at FROM invites WHERE token = ?`)
      .get(req.body.token) as
      | {
          token: string;
          room_id: string;
          role: "Contributor" | "Viewer";
          expires_at: number;
          revoked_at: number | null;
        }
      | undefined;
    if (!inv) return reply.code(404).send({ error: "invite_not_found" });
    if (inv.revoked_at) return reply.code(410).send({ error: "invite_revoked" });
    if (Date.now() > inv.expires_at) return reply.code(410).send({ error: "invite_expired" });

    // Idempotent: don't downgrade an existing member.
    const existing = db
      .prepare(`SELECT role FROM room_members WHERE room_id = ? AND user_id = ?`)
      .get(inv.room_id, claims.sub) as
      | { role: "Lead" | "Contributor" | "Viewer" }
      | undefined;
    if (!existing) {
      db.prepare(
        `INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)`,
      ).run(inv.room_id, claims.sub, inv.role);
    }
    db.prepare(
      `UPDATE invites SET redeemed_count = redeemed_count + 1 WHERE token = ?`,
    ).run(inv.token);

    return { room_id: inv.room_id, role: existing?.role ?? inv.role };
  });

  // Lead can revoke.
  app.delete<{ Params: { id: string; token: string } }>(
    "/api/rooms/:id/invites/:token",
    async (req, reply) => {
      const claims = await requireAuth(req);
      if (!claims) return reply.code(401).send({ error: "unauthorized" });
      const ownerCheck = db
        .prepare(`SELECT role FROM room_members WHERE room_id = ? AND user_id = ?`)
        .get(req.params.id, claims.sub) as
        | { role: "Lead" | "Contributor" | "Viewer" }
        | undefined;
      if (!ownerCheck || ownerCheck.role !== "Lead") {
        return reply.code(403).send({ error: "lead_required" });
      }
      db.prepare(
        `UPDATE invites SET revoked_at = ? WHERE token = ? AND room_id = ?`,
      ).run(Date.now(), req.params.token, req.params.id);
      return reply.code(204).send();
    },
  );
}
