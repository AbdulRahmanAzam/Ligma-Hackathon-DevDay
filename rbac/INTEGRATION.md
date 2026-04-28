# RBAC Integration Guide — Ligma

> Audience: **RBAC / security developer** owning node-level permissions and authentication for Ligma (Challenge 02).
>
> Owner of this doc: Frontend / Canvas team.
> Last updated: 2026-04-28.

This document defines the contract the **frontend canvas client** expects for authentication, role assignment, and per-node access control.

The judges will test RBAC by **sending raw WebSocket frames or curl requests**. Client-only guards earn zero. RBAC must be enforced server-side, and this document tells you exactly where.

---

## 1. Roles

```ts
type UserRole = 'Lead' | 'Contributor' | 'Viewer'
```

The frontend lets the user pick a role from a segmented control on the top bar. In production, the role must come from the auth subsystem you build.

| Role | Default capabilities |
|---|---|
| `Lead` | Full read/write on every node. Can lock a node to specific roles. |
| `Contributor` | Read/write on unlocked nodes. Read-only on Lead-locked nodes. |
| `Viewer` | Read on every node. Cannot create/update/delete unless the lock array explicitly includes `Viewer`. |

## 2. Per-node ACL — the source of truth

Every canvas node carries its own ACL inside the tldraw shape metadata:

```ts
shape.meta.ligma = {
  authorId: string
  authorName: string
  authorColorIndex: number
  authorRole: 'Lead' | 'Contributor' | 'Viewer'
  createdAt: string                                  // ISO
  lockedToRoles: ('Lead' | 'Contributor' | 'Viewer')[]
}
```

Predicate: a role can mutate a shape **iff** `lockedToRoles` is empty **or** includes that role.

Reference implementation lives in `frontend/server/ligma-sync-server.mjs` as `canMutateShape(shape, role)` and is mirrored client-side as a UI affordance only.

## 3. Server-side enforcement (mandatory)

You will own this. The integration point is the WebSocket server's `canvas-delta` handler. For each entry in `delta.added` / `delta.updated` / `delta.removed`:

1. Look up the **previous** server-state record for that shape id.
2. Read `meta.ligma.lockedToRoles` from that record (never trust the new payload's lock list — locking itself is a privileged op, see §5).
3. If the array is non-empty and does not include the connected client's role, **reject** the entire mutation:

```json
{
  "type": "mutation-rejected",
  "rejected": [
    { "id": "shape:abc", "reason": "Locked to Lead" }
  ]
}
```

4. Do not broadcast the rejected entry. Continue processing other entries that are allowed (or reject the whole frame — the frontend handles either).

## 4. Auth (production hardening)

The hackathon demo skips auth. For production:

- Issue short-lived JWTs containing `{ sub, name, role }`.
- The client sends the JWT in the `hello` payload as `auth: '<jwt>'` (proposed; coordinate with the backend dev).
- Server validates the JWT, derives the role, and **ignores** `role` from the `hello` payload.
- All subsequent messages in that socket are bound to the validated role.

> Coordinate with the **backend** dev to extend the `hello` schema and update `frontend/integration.json`.

## 5. Lock changes are privileged

A shape `update` that **modifies** `meta.ligma.lockedToRoles` is a privileged operation:

- Only `Lead` may add or remove roles from `lockedToRoles`.
- Even if the role can otherwise mutate the shape (e.g., a Contributor moving an unlocked sticky), they cannot change the lock list.
- Server compares previous vs. next `lockedToRoles`; if they differ and the connected role !== `Lead`, reject the entire entry.

## 6. Append-only event log + audit

Every mutation that passes RBAC is recorded as a `CanvasEvent` (see `backend/INTEGRATION.md` §4). Locks/unlocks should produce an event with `label: 'Locked to Lead'` / `'Unlocked'` so the audit trail is complete.

## 7. Test contract (judges will run something like this)

```js
import WebSocket from 'ws'

const url = 'ws://localhost:8787/ligma-sync'
const roomId = 'ligma-rbac-smoke'
const shape = {
  typeName: 'shape',
  id: 'shape:rbac-smoke-node',
  type: 'geo',
  x: 0, y: 0, props: {},
  meta: {
    ligma: {
      authorId: 'lead-smoke', authorName: 'Lead', authorRole: 'Lead',
      authorColorIndex: 0,
      createdAt: new Date().toISOString(),
      lockedToRoles: ['Lead'],
    },
  },
}

const lead = new WebSocket(url)
lead.once('open', () => lead.send(JSON.stringify({
  type: 'hello', roomId, sessionId: 'lead', name: 'Lead', color: '#0ea5e9', role: 'Lead', lastEventSeq: 0,
})))
lead.once('message', () => lead.send(JSON.stringify({
  type: 'canvas-delta', delta: { added: { [shape.id]: shape }, updated: {}, removed: {} },
})))

const viewer = new WebSocket(url)
viewer.once('open', () => viewer.send(JSON.stringify({
  type: 'hello', roomId, sessionId: 'viewer', name: 'Viewer', color: '#f97316', role: 'Viewer', lastEventSeq: 0,
})))
viewer.on('message', (raw) => {
  const msg = JSON.parse(raw.toString())
  if (msg.type === 'sync-welcome') {
    viewer.send(JSON.stringify({
      type: 'canvas-delta',
      delta: { added: {}, updated: { [shape.id]: [shape, { ...shape, x: 42 }] }, removed: {} },
    }))
  }
  if (msg.type === 'mutation-rejected') console.log('PASS:', msg)
})
```

Expected output:

```
PASS: { type: 'mutation-rejected', rejected: [ { id: 'shape:rbac-smoke-node', reason: 'Locked to Lead' } ] }
```

This script has been run against `frontend/server/ligma-sync-server.mjs` and passes.

## 8. UI affordances already shipped

The frontend already shows:

- A 🔒 lock icon next to nodes with a non-empty `lockedToRoles`.
- Lead-only "Lock to Lead", "Lock to Contributor", "Unlock" buttons in the right-hand panel.
- A status pill ("Locked for Lead") when the local user attempts a forbidden mutation.

You do **not** need to touch frontend code. Just ensure the server enforces the predicate.

## 9. Non-goals for the rbac dev

- Adding new UI. The frontend is finished.
- Defining new shape fields. Use `meta.ligma.lockedToRoles` only.
- Running AI inference. Coordinate with `AI/INTEGRATION.md`.
