# Ligma — Real-time Ideation → Execution

DevDay Hackathon 2026. Four developers, one repo.

```
DevDay Hackathon 2026/
├─ frontend/   ← React + Vite + tldraw v3 canvas client (DONE)
├─ backend/    ← Production WebSocket + persistence (TODO — see backend/INTEGRATION.md)
├─ AI/         ← Intent classification service (TODO — see AI/INTEGRATION.md)
└─ rbac/       ← Auth + node-level access control (TODO — see rbac/INTEGRATION.md)
```

## Run the canvas locally

```powershell
cd frontend
npm install
npm run dev    # starts custom WebSocket sync server (8787) + Vite (5173/5174)
```

Open two tabs at `http://localhost:5173/?room=demo` to verify two-tab sync.

Health check: `curl http://localhost:8787/health`.

## What the frontend ships

All 11 frontend cards are implemented and verified. See `frontend/integration.json` for the per-card status and file map.

- Custom WebSocket protocol (no `@tldraw/sync`, no `y-websocket`).
- Tldraw v3 canvas with shape deltas, sticky notes, draw, geo, text.
- Live cursor presence in **tldraw page coordinates** (correct under pan/zoom).
- Yjs-backed task board projection linked back to source canvas nodes.
- Animated intent badges anchored to the live shape bounds.
- Node-level RBAC with client UI affordances **and** server enforcement.
- Append-only event log with `seq`-based reconnect replay.
- Time-travel replay scrubber that keeps incoming live deltas correctly buffered.
- Onboarding tour and 1280–1920 px responsive layout.

## Per-team handoff

| Team | Doc | Status |
|---|---|---|
| Frontend / Canvas | `frontend/integration.json`, `frontend/README.md` | ✅ Done |
| Backend (persistence + scaling) | `backend/INTEGRATION.md` | ⏳ Spec written, implementation pending |
| AI (intent classification) | `AI/INTEGRATION.md` | ⏳ Spec written, service pending |
| RBAC (auth + ACL enforcement) | `rbac/INTEGRATION.md` | ⏳ Spec written, server-side enforcement is a hackathon must-have |

## Hackathon non-negotiables

1. **Custom WebSockets only.** No prebuilt sync libs.
2. **Server-side RBAC.** Judges will send raw `ws` frames. Client guards earn zero.
3. **Append-only event log.** Every mutation gets a monotonic `seq`.
4. **Reconnect replays only missed events** via `lastEventSeq` in `hello`.
5. **CRDT for canvas state.** Tldraw's built-in CRDT + a Yjs `Y.Array` for tasks.

## One-line verification

```powershell
# Two-tab sync
start http://localhost:5173/?room=verify ; start http://localhost:5173/?room=verify

# RBAC raw-WS smoke (run from frontend/)
node ./scripts/rbac-smoke.mjs   # see rbac/INTEGRATION.md §7 for the script body
```
