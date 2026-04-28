import { EventKind } from "@ligma/shared";
import type { WsClient } from "../sync/ws-client";
import type { CanvasStore } from "../canvas/store";
import { classify } from "./classifier";

const DEBOUNCE_MS = 600;

/**
 * Per-node debounce: when a node's text settles for DEBOUNCE_MS, classify it
 * and emit an INTENT_LABELED event. The event flows through the same WS / event
 * log / projection path as anything else — the AI is just another actor.
 */
export class IntentPipeline {
  private timers = new Map<string, number>();
  private inflight = new Set<string>();
  private lastEmittedLabel = new Map<string, string>();

  constructor(
    private store: CanvasStore,
    private ws: WsClient,
  ) {}

  start(): () => void {
    const unsub = this.store.subscribe(() => this.onStoreChange());
    return unsub;
  }

  private onStoreChange(): void {
    for (const node of this.store.snapshot().nodes.values()) {
      if (node.deleted) continue;
      if (node.kind !== "sticky") continue;
      const existing = this.timers.get(node.node_id);
      if (existing) window.clearTimeout(existing);
      const t = window.setTimeout(() => this.classifyOne(node.node_id), DEBOUNCE_MS);
      this.timers.set(node.node_id, t);
    }
  }

  private async classifyOne(nodeId: string): Promise<void> {
    if (this.inflight.has(nodeId)) return;
    const node = this.store.snapshot().nodes.get(nodeId);
    if (!node || node.deleted) return;
    const text = node.text.trim();
    if (text.length < 3) return;
    this.inflight.add(nodeId);
    try {
      const r = await classify(text);
      if (!r) return;
      // Suppress no-op re-emits (same label).
      if (this.lastEmittedLabel.get(nodeId) === r.label) return;
      this.lastEmittedLabel.set(nodeId, r.label);
      this.ws.emitOp(EventKind.INTENT_LABELED, nodeId, {
        label: r.label,
        score: r.score,
      });
    } catch (err) {
      console.warn("[ligma] classify failed", err);
    } finally {
      this.inflight.delete(nodeId);
    }
  }
}
