/**
 * Multi-layer authorization for MCP endpoints:
 *   1. Valid JWT (verifyToken)
 *   2. User is a member of the target room (getRoleInRoom)
 *   3. That role is "Lead"
 * Failures emit audit logs with the user id, room id, and reason.
 */
import type { FastifyRequest } from "fastify";
import { verifyToken, getRoleInRoom } from "../api/auth.js";
import type { JwtClaims } from "../api/auth.js";

export type AuthFailureReason =
  | "missing_token"
  | "invalid_token"
  | "not_room_member"
  | "insufficient_permissions";

export interface AuthSuccess {
  ok: true;
  claims: JwtClaims;
  roomRole: "Lead" | "Contributor" | "Viewer";
}

export interface AuthFailure {
  ok: false;
  status: 401 | 403;
  reason: AuthFailureReason;
  message: string;
}

export type AuthResult = AuthSuccess | AuthFailure;

function getBearer(req: FastifyRequest): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

function audit(
  reason: AuthFailureReason,
  meta: { userId?: string; roomId?: string; route?: string },
): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[mcp:auth] denied reason=${reason} user=${meta.userId ?? "?"} room=${meta.roomId ?? "?"} route=${meta.route ?? "?"}`,
  );
}

export async function authorizeLeadInRoom(
  req: FastifyRequest,
  roomId: string,
  route: string,
): Promise<AuthResult> {
  const token = getBearer(req);
  if (!token) {
    audit("missing_token", { roomId, route });
    return {
      ok: false,
      status: 401,
      reason: "missing_token",
      message: "Authentication required. Provide a Bearer token.",
    };
  }
  const claims = await verifyToken(token);
  if (!claims) {
    audit("invalid_token", { roomId, route });
    return {
      ok: false,
      status: 401,
      reason: "invalid_token",
      message: "Authentication required. Token is invalid or expired.",
    };
  }

  const roomRole = getRoleInRoom(claims.sub, roomId);
  if (!roomRole) {
    audit("not_room_member", { userId: claims.sub, roomId, route });
    return {
      ok: false,
      status: 403,
      reason: "not_room_member",
      message: "AI features are only available to Lead users in this room.",
    };
  }
  if (roomRole !== "Lead") {
    audit("insufficient_permissions", { userId: claims.sub, roomId, route });
    return {
      ok: false,
      status: 403,
      reason: "insufficient_permissions",
      message: "AI features are only available to Lead users.",
    };
  }
  return { ok: true, claims, roomRole };
}
