import type { FastifyInstance } from "fastify";
import { getUser, loginByPassword, signToken, verifyToken } from "./auth.js";

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post<{ Body: { email: string; password: string } }>(
    "/api/auth/login",
    async (req, reply) => {
      const claims = await loginByPassword(req.body.email, req.body.password);
      if (!claims) return reply.code(401).send({ error: "invalid_credentials" });
      const token = await signToken(claims);
      return { token, user: claims };
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
    return user;
  });

  // Dev-only: mints a JWT for any seeded user. Disabled if NODE_ENV=production
  // unless ALLOW_DEV_TOKEN=1 is explicitly set.
  app.post<{ Body: { user_id: string } }>(
    "/api/auth/dev-token",
    async (req, reply) => {
      if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_TOKEN !== "1") {
        return reply.code(404).send({ error: "not_found" });
      }
      const user = getUser(req.body.user_id);
      if (!user) return reply.code(404).send({ error: "user_not_found" });
      const token = await signToken({
        sub: user.user_id,
        email: user.email,
        display: user.display,
      });
      return { token, ...user };
    },
  );
}
