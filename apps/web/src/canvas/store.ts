import { useSyncExternalStore } from "react";
import {
  type BaseEvent,
  EventKind,
  type IntentLabeledPayload,
  type NodeCreatedPayload,
  type NodeMovedPayload,
  type NodeResizedPayload,
  type NodeRestyledPayload,
  type StickyTextDeltaPayload,
  type StrokeAppendedPayload,
} from "@ligma/shared";
import { StickyTextRegistry } from "../sync/yjs-room";

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
  intent?: { label: string; score: number };
  strokes?: Array<{ points: Array<{ x: number; y: number }>; stroke: string; strokeWidth: number }>;
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
  readonly stickyText = new StickyTextRegistry();

  snapshot(): CanvasState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    // Construct a new state object so React/sync sees a change.
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
          stroke: p.stroke ?? "#92400e",
          text: p.text ?? "",
          created_seq: e.seq,
          last_seq: e.seq,
        });
      }
    } else if (e.kind === EventKind.NODE_MOVED && e.node_id) {
      const n = this.state.nodes.get(e.node_id);
      const p = e.payload as NodeMovedPayload;
      if (n && e.lamport >= 0) {
        // Property-level Lamport-stamped LWW: position is its own clock.
        n.x = p.x;
        n.y = p.y;
        n.last_seq = e.seq;
      }
    } else if (e.kind === EventKind.NODE_RESIZED && e.node_id) {
      const n = this.state.nodes.get(e.node_id);
      const p = e.payload as NodeResizedPayload;
      if (n) {
        n.w = p.w;
        n.h = p.h;
        n.last_seq = e.seq;
      }
    } else if (e.kind === EventKind.NODE_RESTYLED && e.node_id) {
      const n = this.state.nodes.get(e.node_id);
      const p = e.payload as NodeRestyledPayload;
      if (n) {
        if (p.fill) n.fill = p.fill;
        if (p.stroke) n.stroke = p.stroke;
        n.last_seq = e.seq;
      }
    } else if (e.kind === EventKind.STICKY_TEXT_DELTA && e.node_id) {
      const p = e.payload as StickyTextDeltaPayload;
      this.stickyText.applyUpdate(e.node_id, p.yjs_update_b64);
      const n = this.state.nodes.get(e.node_id);
      if (n) {
        n.text = this.stickyText.text(e.node_id);
        n.last_seq = e.seq;
      }
    } else if (e.kind === EventKind.NODE_DELETED && e.node_id) {
      const n = this.state.nodes.get(e.node_id);
      if (n) {
        n.deleted = true;
        n.last_seq = e.seq;
      }
    } else if (e.kind === EventKind.INTENT_LABELED && e.node_id) {
      const p = e.payload as IntentLabeledPayload;
      const n = this.state.nodes.get(e.node_id);
      if (n) n.intent = { label: p.label, score: p.score };
    } else if (e.kind === EventKind.STROKE_APPENDED && e.node_id) {
      const p = e.payload as StrokeAppendedPayload;
      const n = this.state.nodes.get(e.node_id);
      if (n) {
        if (!n.strokes) n.strokes = [];
        n.strokes.push({ points: p.points, stroke: p.stroke, strokeWidth: p.strokeWidth });
        n.last_seq = e.seq;
      }
    }

    this.emit();
  }

  clear(): void {
    this.state = { nodes: new Map(), seqMax: 0 };
    this.emit();
  }
}

export function useCanvasStore<T>(store: CanvasStore, sel: (s: CanvasState) => T): T {
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => sel(store.snapshot()),
  );
}
