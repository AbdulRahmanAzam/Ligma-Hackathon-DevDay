import {
  type EventKind,
  type Role,
  isPrivilegedKind,
  roleCanEmit,
} from "@ligma/shared";
import { effectiveRole } from "./role-cache.js";

export type AuthorizeOk = { ok: true; role: Role };
export type AuthorizeDenied = { ok: false; reason: string };
export type AuthorizeResult = AuthorizeOk | AuthorizeDenied;

/**
 * Ring 2 chokepoint. Every WS op routes through this. The SQL trigger (Ring 3)
 * is defense in depth; this is where the security boundary lives.
 */
export function authorize(
  userId: string,
  roomId: string,
  nodeId: string | null,
  kind: EventKind,
): AuthorizeResult {
  const role = effectiveRole(userId, roomId, nodeId);
  if (!role) {
    return { ok: false, reason: "no_role_in_room" };
  }

  if (isPrivilegedKind(kind) && role !== "lead") {
    return { ok: false, reason: "privileged_op_requires_lead" };
  }

  if (!roleCanEmit(role, kind)) {
    return { ok: false, reason: `role_${role}_cannot_${kind}` };
  }

  return { ok: true, role };
}
