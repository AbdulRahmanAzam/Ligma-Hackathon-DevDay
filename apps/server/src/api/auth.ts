import argon2 from "argon2";
import { jwtVerify, SignJWT } from "jose";
import { db } from "../db/sqlite.js";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-secret-do-not-use-in-prod-fa9c01ed94",
);
const ISS = "ligma";
const TTL = "12h";

export interface JwtClaims {
  sub: string;
  email: string;
  display: string;
  role: "Lead" | "Contributor" | "Viewer";
}

export async function signToken(claims: JwtClaims): Promise<string> {
  return new SignJWT({ email: claims.email, display: claims.display, role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISS)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<JwtClaims | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, { issuer: ISS });
    if (typeof payload.sub !== "string") return null;
    const role = payload["role"];
    return {
      sub: payload.sub,
      email: String(payload["email"] ?? ""),
      display: String(payload["display"] ?? ""),
      role: role === "Lead" || role === "Contributor" || role === "Viewer" ? role : "Viewer",
    };
  } catch {
    return null;
  }
}

const findByEmail = db.prepare(`
  SELECT user_id, email, display, pw_hash FROM users WHERE email = ?
`);

const findById = db.prepare(`
  SELECT user_id, email, display FROM users WHERE user_id = ?
`);

const insertUser = db.prepare(`
  INSERT INTO users (user_id, email, display, pw_hash) VALUES (?, ?, ?, ?)
`);

export async function ensureUser(
  user_id: string,
  email: string,
  display: string,
  password: string,
): Promise<void> {
  const existing = findById.get(user_id);
  if (existing) return;
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  insertUser.run(user_id, email, display, hash);
}

export async function loginByPassword(
  email: string,
  password: string,
): Promise<{ user_id: string; email: string; display: string } | null> {
  const row = findByEmail.get(email) as
    | { user_id: string; email: string; display: string; pw_hash: string }
    | undefined;
  if (!row) return null;
  const ok = await argon2.verify(row.pw_hash, password);
  if (!ok) return null;
  return { user_id: row.user_id, email: row.email, display: row.display };
}

export function getUser(
  user_id: string,
): { user_id: string; email: string; display: string } | null {
  return (findById.get(user_id) ?? null) as
    | { user_id: string; email: string; display: string }
    | null;
}

export function getRoleInRoom(user_id: string, room_id: string): "Lead" | "Contributor" | "Viewer" | null {
  const m = db
    .prepare(`SELECT role FROM room_members WHERE room_id = ? AND user_id = ?`)
    .get(room_id, user_id) as { role: "Lead" | "Contributor" | "Viewer" } | undefined;
  if (m) return m.role;
  const r = db
    .prepare(`SELECT default_role FROM rooms WHERE room_id = ?`)
    .get(room_id) as { default_role: "Lead" | "Contributor" | "Viewer" } | undefined;
  return r?.default_role ?? null;
}
