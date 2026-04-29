# LIGMA — Real-time Ideation → Execution

DevDay '26 Hackathon submission. A live whiteboard that turns brainstorms
into tracked tasks, with role-aware permissions and shareable invite links.

## What's in here
 
```
ligma-hackathon/
├─ apps/
│   ├─ web/        React 19 + Vite + tldraw v3 canvas client
│   └─ server/     Fastify + ws + better-sqlite3 backend (auth, rooms, sync)
└─ packages/
    └─ shared/     Shared types between client and server
```

A single Node process serves the static SPA, the REST API (`/api/*`), and
the WebSocket sync (`/ligma-sync`). SQLite handles persistence.

## Run it locally

Requires **Node 20+** and **npm**.

```bash
npm install
npm run dev
```

- Client: http://localhost:5173 (Vite, proxies `/api` and `/ligma-sync` → server)
- Server: http://localhost:8090

Sign up with any email + password, create a whiteboard, invite collaborators.

### Windows note

`better-sqlite3` and `argon2` need a C++ toolchain. Install Visual Studio
Build Tools (Desktop development with C++) once, then `npm install`.

## Roles

- **Lead** — room creator. Can invite, revoke links, remove members, lock
  shapes to a role tier.
- **Contributor** — can draw, type, move shapes. Sign-in required.
- **Viewer** — read-only. Anonymous Viewer invites skip the login screen
  entirely (browser → live canvas).

## Deploy

The hackathon instance runs on a single VPS (Node + systemd + SQLite WAL).
Build the workspace and copy `apps/web/dist` and `apps/server/dist` to the
target host; `apps/server/dist/db/schema.sql` must travel with the JS.

```bash
npm run -ws build
```

## Hackathon brief

See `Hackathon Task.txt` for the original problem statement.
