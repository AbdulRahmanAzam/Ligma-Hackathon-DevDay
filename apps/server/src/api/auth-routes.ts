import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { v4 as uuid } from "uuid";
import argon2 from "argon2";
import { db } from "../db/sqlite.js";
import { getUser, loginByPassword, signToken, verifyToken } from "./auth.js";

// ---------------------------------------------------------------------------
// Simple in-memory rate limiter for auth endpoints.
// Max 5 attempts per IP per 60-second sliding window.
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

const rateLimitMap = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  let timestamps = rateLimitMap.get(ip);
  if (!timestamps) {
    timestamps = [];
    rateLimitMap.set(ip, timestamps);
  }
  // Evict entries older than the window
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0]! < cutoff) {
    timestamps.shift();
  }
  if (timestamps.length >= RATE_LIMIT_MAX) {
    return true;
  }
  timestamps.push(now);
  return false;
}

/** Periodic cleanup of stale IPs to prevent memory growth. */
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [ip, ts] of rateLimitMap) {
    if (ts.length === 0 || ts[ts.length - 1]! < cutoff) {
      rateLimitMap.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW_MS);

function checkRateLimit(req: FastifyRequest, reply: FastifyReply): boolean {
  const ip = req.ip;
  if (isRateLimited(ip)) {
    reply
      .code(429)
      .header("Retry-After", "60")
      .send({ error: "rate_limited", message: "Too many attempts, try again later" });
    return true;
  }
  return false;
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post<{
    Body: { email: string; password: string; display: string };
  }>("/api/auth/register", async (req, reply) => {
    if (checkRateLimit(req, reply)) return;

    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const display = String(req.body?.display ?? "").trim();

    if (!email || !email.includes("@") || email.length > 200) {
      return reply.code(400).send({ error: "invalid_email" });
    }
    if (password.length < 8) {
      return reply.code(400).send({ error: "password_too_short" });
    }
    if (!display || display.length > 80) {
      return reply.code(400).send({ error: "invalid_display" });
    }

    const taken = db
      .prepare("SELECT 1 FROM users WHERE email = ?")
      .get(email);
    if (taken) return reply.code(409).send({ error: "email_taken" });

    const user_id = `u_${uuid().slice(0, 10)}`;
    const pw_hash = await argon2.hash(password, { type: argon2.argon2id });
    db.prepare(
      `INSERT INTO users (user_id, email, display, pw_hash) VALUES (?, ?, ?, ?)`,
    ).run(user_id, email, display, pw_hash);

    const token = await signToken({
      sub: user_id,
      email,
      display,
      role: "Viewer",
    });
    return reply.code(201).send({
      token,
      user: { user_id, email, display, role: "Viewer" },
    });
  });

  app.post<{ Body: { email: string; password: string } }>(
    "/api/auth/login",
    async (req, reply) => {
      if (checkRateLimit(req, reply)) return;

      const claims = await loginByPassword(req.body.email, req.body.password);
      if (!claims) return reply.code(401).send({ error: "invalid_credentials" });
      // The JWT carries identity only. Per-room role is fetched live from
      // the server (GET /api/rooms/:id) so role changes don't require a
      // re-login. The role field here is a default that the client overrides
      // immediately on entering a room.
      const token = await signToken({
        sub: claims.user_id,
        email: claims.email,
        display: claims.display,
        role: "Viewer",
      });
      return { token, user: { ...claims, role: "Viewer" } };
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

}

