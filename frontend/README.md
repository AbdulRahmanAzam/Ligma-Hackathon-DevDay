# Ligma Frontend

Ligma is the DevDay Hackathon collaborative workspace that connects live canvas ideation to structured execution output. This frontend is initialized with Vite, React, TypeScript, and tldraw v3.

## Current Implementation

- Infinite tldraw canvas with sticky notes, freehand drawing, shapes, and text blocks.
- Custom in-repo WebSocket sync server for tldraw shape deltas. No hosted `@tldraw/sync` or prebuilt websocket sync server is used.
- Connection states for `connecting`, `online`, and `offline`, with reconnect using missed event replay by `lastEventSeq`.
- Cursor presence overlay with per-user name, color, and role through the custom WebSocket channel.
- Independently addressable canvas nodes using native tldraw shape IDs.
- Client-side node metadata for author, timestamp, role, color, and role locks.
- Server-side validation for node-level RBAC on incoming shape deltas.
- Intent-aware action extraction from text-bearing nodes into a Yjs `Y.Array` task projection.
- Animated Framer Motion intent badges for action, decision, question, and reference nodes.
- Collapsible task board side panel with task author avatar, timestamp, and click-to-zoom node focus.
- Bottom time-travel replay scrubber with play/pause/speed controls and read-only preview mode.
- First-time onboarding tour for sticky creation, dragging, and task creation.
- Append-only UI event log sourced from authoritative server events.

## Run Locally

```bash
npm install
npm run dev
```

`npm run dev` starts both the custom sync server and Vite. Open the same `?room=` URL in two browser tabs to validate real-time canvas edits, task-board updates, cursor presence, and event replay.

Useful commands:

```bash
npm run sync      # custom WebSocket sync server only, default ws://localhost:8787/ligma-sync
npm run dev:vite  # Vite frontend only
npm run lint
npm run build
```

## Architecture Notes

The frontend now uses `server/ligma-sync-server.mjs` for custom JSON-over-WebSocket collaboration. Clients send tldraw shape deltas only, not full canvas state. The server validates node-level RBAC, appends authoritative events with sequence numbers, broadcasts accepted deltas, and returns missed events when a client reconnects.

The task board subscribes to a Yjs `Y.Array<CanvasTask>` projection. Tasks keep `nodeId` as the source-of-truth link back to the originating canvas node, so future backend/AI services should store tasks as projections that reference `shape.id`, author metadata, and event sequence numbers.

The current intent classifier is a frontend heuristic so the canvas UI can be completed before the AI developer integrates the real classifier. Replace `classifyIntent` in `src/App.tsx` or feed intent into `TLShape.meta.ligma` when the AI service is ready.

See `integration.json` for the implemented Trello cards, route, WebSocket protocol, message contracts, environment variables, and integration notes for backend/AI developers.
