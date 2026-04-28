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

  private docObservers = new Map<string, () => void>();

  start(): () => void {
    const unsub = this.store.subscribe(() => this.onStoreChange());
    // Initial pass — observe any nodes that already exist.
    this.onStoreChange();
    return () => {
      unsub();
      for (const [nodeId, off] of this.docObservers) {
        const t = this.store.stickyText.doc(nodeId).getText("body");
        t.unobserve(off);
      }
      this.docObservers.clear();
      for (const t of this.timers.values()) window.clearTimeout(t);
    };
  }

  private onStoreChange(): void {
    for (const node of this.store.snapshot().nodes.values()) {
      if (node.deleted) {
        const off = this.docObservers.get(node.node_id);
        if (off) {
          this.store.stickyText.doc(node.node_id).getText("body").unobserve(off);
          this.docObservers.delete(node.node_id);
        }
        continue;
      }
      if (node.kind !== "sticky") continue;
      if (this.docObservers.has(node.node_id)) continue;

      const onTextChange = () => this.scheduleClassify(node.node_id);
      this.store.stickyText.doc(node.node_id).getText("body").observe(onTextChange);
      this.docObservers.set(node.node_id, onTextChange);
      // Also schedule once for any text already in the doc.
      this.scheduleClassify(node.node_id);
    }
  }

  private scheduleClassify(nodeId: string): void {
    const existing = this.timers.get(nodeId);
    if (existing) window.clearTimeout(existing);
    const t = window.setTimeout(() => this.classifyOne(nodeId), DEBOUNCE_MS);
    this.timers.set(nodeId, t);
  }

  private async classifyOne(nodeId: string): Promise<void> {
    if (this.inflight.has(nodeId)) return;
    const node = this.store.snapshot().nodes.get(nodeId);
    if (!node || node.deleted) return;
    // Read live text from the Yjs doc (which reflects merged remote+local).
    const text = this.store.stickyText.text(nodeId).trim();
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
