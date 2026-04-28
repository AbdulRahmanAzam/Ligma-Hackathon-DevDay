# Backend Integration Guide — Ligma

> Audience: **Backend developer** building persistence, the production WebSocket fan-out, and event durability for Ligma.
>
> Owner of this doc: Frontend / Canvas team.
> Last updated: 2026-04-28.

This document is the contract the **frontend canvas client** speaks. Build a server that satisfies these messages and the frontend works end-to-end without any code changes.

A reference implementation in plain Node + `ws` already exists at `frontend/server/ligma-sync-server.mjs` — treat it as a working spec, then re-implement it in your stack of choice (NestJS, Fastify, Go, etc.) with persistence, auth, scaling, and durable event log.

---

## 1. Transport

- **Protocol:** plain text JSON over a **custom WebSocket** server (no `@tldraw/sync`, no `y-websocket`, no Socket.IO — the hackathon disallows prebuilt sync libs).
- **URL the client connects to:** `ws://<host>:<port>/ligma-sync`
  - Frontend reads it from `import.meta.env.VITE_LIGMA_SYNC_URL`, otherwise derives `${ws|wss}://${location.hostname}:8787/ligma-sync`.
- **Health endpoint (HTTP):** `GET /health → { ok: true, rooms: number }`.

You may switch to binary frames later, but the v1 protocol is JSON for debuggability.

## 2. Connection lifecycle

1. Client opens the socket.
2. Client immediately sends `hello` with the room id, session id, name, color, role, and the last `seq` the client successfully processed.
3. Server replies with **one** `sync-welcome` containing the current room snapshot and any missed events with `seq > lastEventSeq`.
4. Both sides exchange `canvas-delta`, `presence-cursor`, `presence-user`, `yjs-update`, and `mutation-rejected` messages until the socket closes.
5. On disconnect, the client auto-reconnects with the same `sessionId` and an updated `lastEventSeq`. The server **must** replay only missed events.

## 3. Message envelope

All messages are JSON objects with a required `type` discriminator.

### Client → Server

| `type` | Required fields | Notes |
|---|---|---|
| `hello` | `roomId`, `sessionId`, `name`, `color`, `role`, `lastEventSeq` | Joins a room. `role` ∈ `Lead` / `Contributor` / `Viewer`. |
| `canvas-delta` | `delta.added`, `delta.updated`, `delta.removed` | Tldraw store deltas only — never full state. Values are `TLShape` records. |
| `presence-cursor` | `x`, `y` | **Page coordinates** in tldraw page space (not screen pixels). Identity is taken from the socket's session. |
| `yjs-update` | `update` (number[]) | An encoded Yjs update for the shared `Y.Array<CanvasTask>` named `tasks`. Server treats it as opaque bytes. |

### Server → Client

| `type` | Required fields | Notes |
|---|---|---|
| `sync-welcome` | `roomId`, `serverTime`, `shapes`, `events`, `taskUpdate`, `users` | One-shot per connection. `taskUpdate` is an encoded Yjs state vector for the tasks doc. |
| `canvas-delta` | `senderSessionId`, `delta`, `events` | Broadcast accepted deltas + authoritative append-only event entries. The originator also receives this back to confirm seq numbers. |
| `mutation-rejected` | `rejected: { id, reason }[]` | Server-side RBAC denial. |
| `presence-cursor` | `sessionId`, `name`, `color`, `role`, `x`, `y` | Cursor in **tldraw page coordinates**. |
| `presence-user` | `phase` (`join` / `leave`), `sessionId`, `name`, `color`, `role` | Roster updates. |
| `yjs-update` | `senderSessionId`, `update` | Broadcast tasks CRDT update to all peers except originator. |

## 4. Append-only event log (Challenge 04)

Every accepted shape mutation **must** be assigned a monotonically increasing `seq` per room and stored:

```ts
type CanvasEvent = {
  id: string                    // uuid
  seq: number                   // monotonic per room
  at: string                    // ISO timestamp
  label: string                 // human-readable
  nodeId?: string               // shape id if applicable
  operation: 'created' | 'updated' | 'deleted'
  source: 'remote' | 'user'
  authorName: string
  authorRole: 'Lead' | 'Contributor' | 'Viewer'
}
```

Persistence target (suggested): Postgres table `room_events(room_id, seq, payload jsonb, created_at)` with `UNIQUE(room_id, seq)`.

On `hello`, return all events with `seq > lastEventSeq` ordered ascending.

## 5. Server-side RBAC enforcement (Challenge 02)

Judges will test by sending raw WebSocket frames. **Client-only guards earn zero**.

For every incoming `canvas-delta`:

1. Look up the existing shape (if any) by id.
2. Read `meta.ligma.lockedToRoles: ('Lead' | 'Contributor' | 'Viewer')[]` from the previous record (the new payload's lock array is **not** trusted on update — the lock change itself is a Lead-only action).
3. If the lock array is non-empty and does not include the connected client's role, drop the mutation and return `mutation-rejected` to that one socket. Do **not** broadcast.
4. Otherwise, assign the next `seq`, persist the event, broadcast `canvas-delta` to the whole room.

The reference implementation lives in `canMutateShape` inside `frontend/server/ligma-sync-server.mjs`. Reuse the same predicate.

## 6. CRDT / conflict resolution (Challenge 01)

The frontend uses tldraw's built-in CRDT for shape state and a Yjs `Y.Array` for the task projection. The backend's only job is to **fan out deltas in arrival order**, never modify them.

Rules:

- Do not merge or de-dup deltas server-side beyond RBAC.
- Echo accepted deltas back to the originator with the `seq`-bearing event, so all clients converge on the same event ordering.
- For `yjs-update`, broadcast verbatim. The CRDT handles convergence.

## 7. Reconnect & missed events (Challenge 05)

- Treat each `hello` with the same `sessionId` as a re-attach, not a new user (you may collapse the join/leave roster spam).
- The `sync-welcome` reply must include every event with `seq > lastEventSeq` so the client can rebuild its event log without dropping anything.
- For long disconnects, also include the **current** snapshot of shapes (full list of `TLShape` records) and the latest `Y.Doc` state so late joiners don't have to replay from event 0.

## 8. Test contract

- `GET /health → { ok: true, rooms: <number> }`.
- A raw `ws` script that:
  1. Connects as a Lead, creates a shape with `meta.ligma.lockedToRoles = ['Lead']`.
  2. Connects as a Viewer, attempts to update the shape.
  3. Expects `{ type: 'mutation-rejected', rejected: [{ id, reason: 'Locked to Lead' }] }`.
- Two browser tabs on the same `?room=` should converge in real time.

## 9. Non-goals for the backend dev

- Building UI. The frontend is finished; do not touch `frontend/src/**`.
- Running AI inference. That is the AI dev's responsibility (`ai/INTEGRATION.md`).
- Defining new message types unilaterally. Coordinate with the frontend team and update `frontend/integration.json` first.

## 10. Reference: working server

`frontend/server/ligma-sync-server.mjs` — Node 20+, `ws@^8`. Run with `npm run sync` from the frontend folder, or `LIGMA_SYNC_PORT=9000 npm run sync` to override the port.

You can copy the room/event/RBAC logic verbatim into your production server.
