import type { FastifyInstance } from "fastify";
import { db } from "../db/sqlite.js";
import { getUser, loginByPassword, signToken, verifyToken } from "./auth.js";

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post<{ Body: { email: string; password: string; room_id?: string } }>(
    "/api/auth/login",
    async (req, reply) => {
      const claims = await loginByPassword(req.body.email, req.body.password);
      if (!claims) return reply.code(401).send({ error: "invalid_credentials" });
      const role = roleFor(claims.user_id, req.body.room_id ?? "rm_demo");
      const token = await signToken({
        sub: claims.user_id,
        email: claims.email,
        display: claims.display,
        role,
      });
      return { token, user: { ...claims, role } };
    },
  );

  app.get("/api/auth/me", async (req, reply) => {
    const auth = req.headers["authorization"];
    if (typeof auth !== "string" || !auth.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const claims = await verifyToken(auth.slice(7));
    if (!claims) return reply.code(401).send({ error: "invalid_token" });
    const user = getUser(claims.sub);
    if (!user) return reply.code(404).send({ error: "user_not_found" });
    return { ...user, role: claims.role };
  });

  // Dev-only: mints a JWT for any seeded user. Disabled in production unless
  // ALLOW_DEV_TOKEN=1 is explicitly set.
  app.post<{ Body: { user_id: string; room_id?: string } }>(
    "/api/auth/dev-token",
    async (req, reply) => {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_TOKEN !== "1") {
        return reply.code(404).send({ error: "not_found" });
      }
      const user = getUser(req.body.user_id);
      if (!user) return reply.code(404).send({ error: "user_not_found" });
      const role = roleFor(user.user_id, req.body.room_id ?? "rm_demo");
      const token = await signToken({
        sub: user.user_id,
        email: user.email,
        display: user.display,
        role,
      });
      return { token, ...user, role };
    },
  );
}

function roleFor(user_id: string, room_id: string): "Lead" | "Contributor" | "Viewer" {
  const m = db
    .prepare(`SELECT role FROM room_members WHERE room_id = ? AND user_id = ?`)
    .get(room_id, user_id) as { role: "Lead" | "Contributor" | "Viewer" } | undefined;
  if (m) return m.role;
  const r = db
    .prepare(`SELECT default_role FROM rooms WHERE room_id = ?`)
    .get(room_id) as { default_role: "Lead" | "Contributor" | "Viewer" } | undefined;
  return r?.default_role ?? "Viewer";
}
