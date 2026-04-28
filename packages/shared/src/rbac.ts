import { EventKind } from "./events.js";

export type Role = "lead" | "contributor" | "viewer";

export const ROLES: Role[] = ["lead", "contributor", "viewer"];

/**
 * Per spec §7.1. Lead has all rights; Contributor has all canvas mutation rights
 * but cannot grant/revoke or delete others' nodes; Viewer is read-only.
 *
 * Encoded server-side in rbac_role_ops as (role, kind) rows so SQL trigger and
 * authorize() read from a single source.
 */
export const RBAC_MATRIX: Record<Role, EventKind[]> = {
  lead: [
    EventKind.NODE_CREATED,
    EventKind.NODE_DELETED,
    EventKind.NODE_MOVED,
    EventKind.NODE_RESIZED,
    EventKind.NODE_RESTYLED,
    EventKind.STICKY_TEXT_DELTA,
    EventKind.STROKE_APPENDED,
    EventKind.PERMISSION_GRANTED,
    EventKind.PERMISSION_REVOKED,
    EventKind.ROLE_CHANGED,
    EventKind.TASK_STATUS_SET,
    EventKind.INTENT_LABELED,
    EventKind.SNAPSHOT_TAKEN,
  ],
  contributor: [
    EventKind.NODE_CREATED,
    EventKind.NODE_MOVED,
    EventKind.NODE_RESIZED,
    EventKind.NODE_RESTYLED,
    EventKind.STICKY_TEXT_DELTA,
    EventKind.STROKE_APPENDED,
    EventKind.TASK_STATUS_SET,
    EventKind.INTENT_LABELED,
  ],
  viewer: [],
};

export function roleCanEmit(role: Role, kind: EventKind): boolean {
  return RBAC_MATRIX[role].includes(kind);
}

export function isPrivilegedKind(kind: EventKind): boolean {
  return (
    kind === EventKind.PERMISSION_GRANTED ||
    kind === EventKind.PERMISSION_REVOKED ||
    kind === EventKind.ROLE_CHANGED
  );
}
