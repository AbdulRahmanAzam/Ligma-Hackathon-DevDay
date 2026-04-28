# AI Integration Guide — Ligma

> Audience: **AI developer** building the intent classification service for Ligma (Challenge 03).
>
> Owner of this doc: Frontend / Canvas team.
> Last updated: 2026-04-28.

This document defines the contract the **frontend canvas client** expects from the AI service. The frontend already renders intent badges and a task board — your job is to replace the placeholder heuristic with a proper LLM-driven classifier.

---

## 1. What the frontend does today

A throwaway heuristic in `frontend/src/App.tsx → classifyIntent(text)` returns one of:

```ts
type Intent = 'action' | 'decision' | 'question' | 'reference'
```

That intent drives:

- **Card 1.6** — Animated intent badge anchored to the top-right of the canvas node.
- **Card 1.5** — Task board side panel: only `action` items are projected into the shared Yjs `Y.Array<CanvasTask>`.
- **Card 1.6 (Challenge 03)** — Hackathon requirement that the AI layer classifies intent.

Replace the heuristic by sending classified intents from your service to either the WebSocket server or directly to the canvas client.

## 2. Two integration shapes (pick one)

### Option A — REST classify endpoint (simpler)

```
POST /ai/classify
Content-Type: application/json

Request:
{
  "nodeId": "shape:abc",       // tldraw shape id, source-of-truth link
  "roomId": "ligma-devday-main",
  "text": "We must ship the canvas reconnect logic before Friday.",
  "authorRole": "Lead"
}

Response:
{
  "nodeId": "shape:abc",
  "intent": "action",
  "confidence": 0.91,
  "summary": "Ship reconnect logic by Friday",
  "model": "gpt-4o-mini",
  "version": "2026-04-28"
}
```

The frontend can call this on a **debounced** node text-change (≥300 ms idle) and patch the node `meta.ligma.intent` field, which then drives badges and tasks.

### Option B — Server-side intent stream (preferred for the hackathon demo)

The custom WebSocket server already sees every `canvas-delta`. Have your AI service subscribe to that server (or a side-channel queue) and emit intent updates back into the room as a new message:

```json
{
  "type": "intent-update",
  "nodeId": "shape:abc",
  "intent": "action",
  "confidence": 0.91,
  "summary": "Ship reconnect logic by Friday",
  "at": "2026-04-28T14:32:11.124Z"
}
```

The frontend will treat this as authoritative and write `intent` into the shape's `meta.ligma.intent`, replacing the local heuristic.

> Coordinate with the **backend** developer to add the `intent-update` message type to `backend/INTEGRATION.md` and to the server's broadcast logic.

## 3. Classification rules (judging-friendly)

Map natural-language signals to one of four labels:

| Intent | Trigger language (examples) |
|---|---|
| `action` | "TODO", "we will", "ship", "build", "fix", "owner: …", "assign", "next step" |
| `decision` | "decided", "approved", "we are going with", "final", "agreed" |
| `question` | "?" present, "open question", "unknown", "risk", "clarify" |
| `reference` | none of the above; informational only |

Tie-breaker order when multiple fire: `action > decision > question > reference`.

Return `confidence: number ∈ [0, 1]`. The frontend can show a faded badge below 0.5.

## 4. Source-of-truth link

The frontend keeps the canvas node as the source of truth. Tasks are **projections** that link back via `nodeId`. **Do not** create new task records on the AI side; only emit intent + an optional `summary` string.

The task board picks up `intent === 'action'` nodes automatically and projects:

```ts
type CanvasTask = {
  nodeId: string                // shape:xxxx
  title: string                 // text or AI summary
  intent: 'action'
  authorName: string
  authorRole: 'Lead' | 'Contributor' | 'Viewer'
  authorColorIndex: number
  createdAt: string
}
```

If you supply `summary`, the frontend will show that in the task row instead of the raw node text.

## 5. Frontend wiring TODOs

The AI dev does not need to touch frontend code, but here is what the frontend will do once you ship:

1. Add a new message handler for `intent-update` in `App.tsx`.
2. Call `editor.updateShapes([{ id: nodeId, type, meta: { ligma: { ...prev, intent, summary } } }])`.
3. Replace `classifyIntent` heuristic with a read of `meta.ligma.intent`.

If you go the REST route, the frontend will instead debounce and call your endpoint directly using `VITE_LIGMA_AI_URL`.

## 6. Performance & cost guardrails

- Debounce per node ≥ 300 ms.
- Cache by `(text, model)` hash; do not re-classify identical text.
- Batch when possible: a `POST /ai/classify-batch` accepting an array is welcome.
- Time-budget: 1.5 s per call. The badge appears optimistically; AI updates it when ready.

## 7. Demo expectations (Challenge 03)

Judges will:

- Type "We must ship the reconnect logic" → expect an **action** badge + a task row in ≤ 2 s.
- Type "Decision: use Postgres" → expect a **decision** badge.
- Type "Should we cache deltas?" → expect a **question** badge.
- Type "Reference: see RFC 6455" → expect a **reference** badge.

## 8. Non-goals for the AI dev

- Building UI. Do not edit `frontend/src/**`.
- Owning persistence. That is the backend dev's responsibility.
- Enforcing RBAC. That is the rbac dev's responsibility.

## 9. Local stub for development

Until the real service exists, the frontend ships a heuristic in `classifyIntent`. Keep it intact — it is the offline fallback and the hackathon-demo safety net.
