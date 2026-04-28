# Ligma Frontend Copilot Instructions

## Project Context

- Ligma is a DevDay Hackathon frontend built with Vite, React, TypeScript, and tldraw v3.
- The primary workflow is a collaborative infinite canvas that turns notes, shapes, and text into execution artifacts.
- Keep changes compatible with strict TypeScript and the existing Vite build.
- Use tldraw APIs for canvas behavior instead of duplicating canvas state outside the editor store.
- Current collaboration uses the in-repo custom WebSocket server in `server/ligma-sync-server.mjs` plus client-side tldraw store deltas in `src/App.tsx`. Do not replace this with hosted `@tldraw/sync`, `y-websocket`, or another prebuilt websocket sync server because the hackathon requires custom WebSockets.
- The task board is a Yjs `Y.Array<CanvasTask>` projection broadcast over the custom WebSocket protocol. Keep tasks linked to source tldraw shape IDs instead of duplicating canvas state.

## Completed Workspace Setup

- [x] Verified this `.github/copilot-instructions.md` file exists.
- [x] Clarified the project as the Ligma Vite React TypeScript frontend with tldraw v3 canvas integration.
- [x] Scaffolded the project in the current workspace folder.
- [x] Customized the app with the Ligma canvas workspace, room controls, custom WebSocket presence, node metadata, node locks, task extraction, animated intent badges, replay controls, onboarding, and event log.
- [x] Installed required npm dependencies. No VS Code extensions were required.
- [x] Compiled and linted the project successfully.
- [x] Created the `Run Ligma frontend` VS Code task.
- [x] Launched the project on the Vite dev server.
- [x] Updated README documentation for setup, validation, and production collaboration notes.