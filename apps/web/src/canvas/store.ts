import { useSyncExternalStore } from "react";
import {
  type BaseEvent,
  EventKind,
  type IntentLabeledPayload,
  type NodeCreatedPayload,
  type NodeMovedPayload,
  type NodeResizedPayload,
  type NodeRestyledPayload,
  type ShapeVariant,
  type StickyTextDeltaPayload,
  type StrokeAppendedPayload,
} from "@ligma/shared";
import { StickyTextRegistry } from "../sync/yjs-room";

export interface NodeStroke {
  points: Array<{ x: number; y: number }>;
  stroke: string;
  strokeWidth: number;
}

export interface NodeState {
  node_id: string;
  kind: "sticky" | "shape" | "text" | "drawing";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  text: string;
  shape?: ShapeVariant;
  end?: { x: number; y: number };
  intent?: { label: string; score: number };
  strokes?: NodeStroke[];
  deleted?: boolean;
  created_seq: number;
  last_seq: number;
}

export interface CanvasState {
  nodes: Map<string, NodeState>;
  seqMax: number;
}

type Listener = () => void;

export class CanvasStore {
  private state: CanvasState = { nodes: new Map(), seqMax: 0 };
  private listeners = new Set<Listener>();
  private nodeArrayCache: NodeState[] = [];
  readonly stickyText = new StickyTextRegistry();

  snapshot(): CanvasState {
    return this.state;
  }

  // Stable-identity helpers for useSyncExternalStore consumers — recomputed
  // only when the underlying state mutates, so React's getSnapshot
  // identity-stability contract holds.
  nodesArray(): NodeState[] {
    return this.nodeArrayCache;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    // Recompute cached projections, then notify.
    this.nodeArrayCache = Array.from(this.state.nodes.values());
    this.state = { ...this.state };
    for (const l of this.listeners) l();
  }

  applyEvent(e: BaseEvent): void {
    this.state.seqMax = Math.max(this.state.seqMax, e.seq);

    if (e.kind === EventKind.NODE_CREATED && e.node_id) {
      const p = e.payload as NodeCreatedPayload;
      if (!this.state.nodes.has(e.node_id)) {
        this.state.nodes.set(e.node_id, {
          node_id: e.node_id,
          kind: p.kind,
          x: p.x,
          y: p.y,
          w: p.w ?? 200,
          h: p.h ?? 140,
          fill: p.fill ?? "#fde68a",
          stroke: p.stroke ?? "#475569",
          text: p.text ?? "",
          shape: p.shape,
          end: p.end,
          created_seq: e.seq,
          last_seq: e.seq,
        });
        // Seed the Yjs doc with any initial text so the textarea reflects it.
        if (p.text) {
          const t = this.stickyText.doc(e.node_id).getText("body");
          if (t.length === 0) t.insert(0, p.text);
        }
      }
    } else if (e.kind === EventKind.NODE_MOVED && e.node_id) {
      const n = this.state.nodes.get(e.node_id);
      const p = e.payload as NodeMovedPayload;
      if (n) {
        this.state.nodes.set(e.node_id, { ...n, x: p.x, y: p.y, last_seq: e.seq });
      }
    } else if (e.kind === EventKind.NODE_RESIZED && e.node_id) {
      const n = this.state.nodes.get(e.node_id);
      const p = e.payload as NodeResizedPayload;
      if (n) {
        this.state.nodes.set(e.node_id, { ...n, w: p.w, h: p.h, last_seq: e.seq });
      }
    } else if (e.kind === EventKind.NODE_RESTYLED && e.node_id) {
      const n = this.state.nodes.get(e.node_id);
      const p = e.payload as NodeRestyledPayload;
      if (n) {
        const next: NodeState = { ...n, last_seq: e.seq };
        if (p.fill) next.fill = p.fill;
        if (p.stroke) next.stroke = p.stroke;
        this.state.nodes.set(e.node_id, next);
      }
    } else if (e.kind === EventKind.STICKY_TEXT_DELTA && e.node_id) {
      const p = e.payload as StickyTextDeltaPayload;
      this.stickyText.applyUpdate(e.node_id, p.yjs_update_b64);
      const n = this.state.nodes.get(e.node_id);
      if (n) this.state.nodes.set(e.node_id, { ...n, last_seq: e.seq });
    } else if (e.kind === EventKind.NODE_DELETED && e.node_id) {
      const n = this.state.nodes.get(e.node_id);
      if (n) {
        this.state.nodes.set(e.node_id, { ...n, deleted: true, last_seq: e.seq });
      }
    } else if (e.kind === EventKind.INTENT_LABELED && e.node_id) {
      const p = e.payload as IntentLabeledPayload;
      const n = this.state.nodes.get(e.node_id);
      if (n) {
        this.state.nodes.set(e.node_id, {
          ...n,
          intent: { label: p.label, score: p.score },
        });
      }
    } else if (e.kind === EventKind.STROKE_APPENDED && e.node_id) {
      const p = e.payload as StrokeAppendedPayload;
      const n = this.state.nodes.get(e.node_id);
      if (n) {
        const strokes = [
          ...(n.strokes ?? []),
          { points: p.points, stroke: p.stroke, strokeWidth: p.strokeWidth },
        ];
        this.state.nodes.set(e.node_id, { ...n, strokes, last_seq: e.seq });
      }
    }

    this.emit();
  }

  clear(): void {
    this.state = { nodes: new Map(), seqMax: 0 };
    this.emit();
  }

  // Apply a mutation locally without going through a server event. Used for
  // optimistic-UI dragging/resizing — the server echo will arrive shortly and
  // we'll only bump seqMax via recordSeq.
  // Replaces the node object (new identity) so React.memo by reference
  // correctly invalidates only this node, not all nodes.
  applyLocalMutation(mut: {
    node_id: string;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    fill?: string;
    stroke?: string;
    deleted?: boolean;
  }): void {
    const n = this.state.nodes.get(mut.node_id);
    if (!n) return;
    const next: NodeState = { ...n };
    if (mut.x !== undefined) next.x = mut.x;
    if (mut.y !== undefined) next.y = mut.y;
    if (mut.w !== undefined) next.w = mut.w;
    if (mut.h !== undefined) next.h = mut.h;
    if (mut.fill !== undefined) next.fill = mut.fill;
    if (mut.stroke !== undefined) next.stroke = mut.stroke;
    if (mut.deleted !== undefined) next.deleted = mut.deleted;
    this.state.nodes.set(mut.node_id, next);
    this.emit();
  }

  recordSeq(seq: number): void {
    if (seq > this.state.seqMax) {
      this.state = { ...this.state, seqMax: seq };
      // No need to recompute nodeArrayCache — the nodes list didn't change.
      for (const l of this.listeners) l();
    }
  }
}

export function useCanvasStore<T>(store: CanvasStore, sel: (s: CanvasState) => T): T {
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => sel(store.snapshot()),
  );
}
