# LIGMA — Spec Rebuild (`spec-rebuild` branch)

A from-scratch monorepo implementation of the LIGMA architecture spec
(`/Users/apple/Downloads/LIGMA_Architecture_Spec.pdf`). Lives alongside the
existing `frontend/`, `backend/INTEGRATION.md`, `AI/INTEGRATION.md`,
`rbac/INTEGRATION.md` folders on `main` — those are untouched.

## What's here

```
apps/
  server/   Node 20 + Fastify + ws + better-sqlite3 + Litestream entrypoint
  web/      Vite + React 18 + custom canvas + transformers.js (browser ONNX)
packages/
  shared/   EventKind, RBAC matrix, WS protocol types — single source of truth
scripts/    (used by apps/server/src/scripts/ at runtime)
render.yaml Single-service Render deployment (free tier)
```

## The eight architectural bets (per spec §17 / Appendix)

| # | Bet | Where it lives |
|---|---|---|
| 1 | Event log is the source of truth; CRDT is a derived projection | `apps/server/src/db/schema.sql` (`events` table), `apps/server/src/events/` |
| 2 | Hybrid conflict resolution: Lamport-LWW for attrs, Yjs Fugue for sticky text | `apps/server/src/util/lamport.ts`, `apps/web/src/sync/yjs-room.ts` |
| 3 | Browser-side ONNX intent classification (zero paid API risk) | `apps/web/src/ai/classifier.ts` (Xenova/mobilebert-uncased-mnli) |
| 4 | Three-ring RBAC: client UX, server `authorize()`, DB `BEFORE INSERT` trigger | `apps/web/src/canvas/Canvas.tsx` (Ring 1), `apps/server/src/rbac/authorize.ts` (Ring 2), `apps/server/src/db/schema.sql` (Ring 3) |
| 5 | SQLite + Litestream → R2 (no Render Postgres expiry) | `apps/server/litestream.yml`, `apps/server/scripts/entrypoint.sh` |
| 6 | Time-Travel Replay reuses the same `rebuildRoom` code path as boot/reconnect | `apps/web/src/timetravel/Scrubber.tsx`, `apps/server/src/events/replay.ts` |
| 7 | tldraw v3 / built-in CRDT — see Trade-off | replaced with a focused custom canvas (see Trade-off below) |
| 8 | Judge Mode HUD endpoints (Cmd+Shift+J overlay UI deferred) | `apps/server/src/api/hud.ts` (`/api/hud/events`, `/denials`, `/state-vector`) |

### Trade-off vs. the PDF

- The PDF picks **tldraw v3** as the canvas substrate. This rebuild ships a
  focused custom canvas (sticky notes, drag, resize, freehand strokes, intent
  badges) so every byte that flows through the event log is owned by us. The
  architectural surface (event log, CRDT, RBAC, projections) is identical;
  the canvas affordances are scoped to what the demo script actually uses.
- The Judge Mode HUD overlay UI (Cmd+Shift+J) is deferred. The HUD's REST
  endpoints are wired and serve the right data — adding the floating panel
  is a UI sprint, not an architectural one.
- Cerebras fallback for the classifier is intentionally not included — the
  spec says it must default to off and we don't enable it.

## Running locally

```bash
# Native deps for argon2 + better-sqlite3 require build approval.
pnpm install
# (one-time) approve native builds
pnpm approve-builds  # answer y for argon2, better-sqlite3
# rebuild if needed:
cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npm run build-release
cd -

# Start server (port 10000) + web (Vite, port 5173 with /api+/ws proxy):
pnpm --filter @ligma/server dev
pnpm --filter @ligma/web dev
```

Open `http://localhost:5173` in two browser tabs. Pick **Alice** (Lead) in one
and **Bob** (Contributor) in the other. Double-click the canvas to add a
sticky note; drag it; type into it. Open a third tab as **Carol** (Viewer)
and watch the canvas refuse to mutate.

## Architecture spec mapping

| Spec section | This repo |
|---|---|
| §3 Data Model | `apps/server/src/db/schema.sql` |
| §3.7 Row trigger (Ring 3) | same file, `trg_events_rbac_check` + `trg_events_privileged_check` |
| §4 Event Sourcing | `apps/server/src/events/{writer,replay,snapshot}.ts` |
| §5 Conflict Resolution | `apps/server/src/util/lamport.ts`, `apps/web/src/sync/yjs-room.ts` |
| §6 WebSocket Protocol | `apps/server/src/ws/gateway.ts`, `packages/shared/src/protocol.ts` |
| §7 Node-Level RBAC | `apps/server/src/rbac/authorize.ts`, `apps/server/src/rbac/role-cache.ts` |
| §8 AI Intent Extraction | `apps/web/src/ai/{classifier,intent-pipeline}.ts` |
| §9 Task Board Projection | `apps/server/src/projections/task-board.ts` |
| §10 Time-Travel Replay | `apps/web/src/timetravel/Scrubber.tsx` |
| §11 Judge Mode HUD | `apps/server/src/api/hud.ts` (endpoints; UI deferred) |
| §12 Deployment on Render | `render.yaml`, `apps/server/Dockerfile`, `apps/server/litestream.yml` |
| §13 API Surface | `apps/server/src/api/{auth-routes,rooms,hud}.ts` |

## Deploying to Render

1. Push this branch to GitHub.
2. Create a new R2 bucket; put the access key + secret in Render's secrets.
3. Render → New → Blueprint → point at `render.yaml`.
4. The Dockerfile builds the monorepo, the entrypoint runs
   `litestream replicate -exec node` so SQLite survives container churn.

JWT_SECRET is auto-generated on first deploy. The seeded users
(`u_alice`, `u_bob`, `u_carol`) password is `demo-password`.

The `/api/auth/dev-token` endpoint is gated on `NODE_ENV !== "production"`
unless `ALLOW_DEV_TOKEN=1` is set — leave that off in real demos.
