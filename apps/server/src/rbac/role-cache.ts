import { db } from "../db/sqlite.js";
import type { Role } from "@ligma/shared";

const TTL_MS = Number(process.env.ROLE_CACHE_TTL_MS ?? 5000);

interface Entry {
  role: Role | null;
  expiresAt: number;
}

const cache = new Map<string, Entry>();

function key(userId: string, nodeId: string | null, roomId: string): string {
  return `${userId}|${nodeId ?? "_"}|${roomId}`;
}

const lookupNode = db.prepare(`
  SELECT role FROM node_permissions WHERE node_id = ? AND user_id = ?
`);

const lookupMember = db.prepare(`
  SELECT role FROM room_members WHERE room_id = ? AND user_id = ?
`);

const lookupDefault = db.prepare(`
  SELECT default_role FROM rooms WHERE room_id = ?
`);

export function effectiveRole(
  userId: string,
  roomId: string,
  nodeId: string | null,
): Role | null {
  const k = key(userId, nodeId, roomId);
  const now = Date.now();
  const hit = cache.get(k);
  if (hit && hit.expiresAt > now) return hit.role;

  let role: Role | null = null;
  if (nodeId) {
    const r = lookupNode.get(nodeId, userId) as { role: Role } | undefined;
    if (r) role = r.role;
  }
  if (!role) {
    const m = lookupMember.get(roomId, userId) as { role: Role } | undefined;
    if (m) role = m.role;
  }
  if (!role) {
    const d = lookupDefault.get(roomId) as { default_role: Role } | undefined;
    if (d) role = d.default_role;
  }

  cache.set(k, { role, expiresAt: now + TTL_MS });
  return role;
}

/**
 * Called by the writer after a permission/role change is persisted, so all
 * gateway processes invalidate at once. Single-instance for now, but the
 * shape is right for future fan-out.
 */
export function invalidateUser(userId: string): void {
  for (const k of cache.keys()) {
    if (k.startsWith(`${userId}|`)) cache.delete(k);
  }
}

export function invalidateAll(): void {
  cache.clear();
}
