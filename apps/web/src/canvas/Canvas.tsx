import React, { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { v4 as uuid } from "uuid";
import {
  EventKind,
  INTENT_BADGE_COLOR,
  INTENT_BADGE_ICON,
  type IntentLabel,
  type Role,
  type ShapeVariant,
} from "@ligma/shared";
import type { CanvasStore, NodeState } from "./store";
import type { WsClient } from "../sync/ws-client";
import { rafThrottle } from "../sync/raf-throttle";
import { StickyTextarea } from "./StickyTextarea";
import { ShapeNode } from "./ShapeNode";
import { DrawingNode } from "./DrawingNode";
import { ResizeHandles } from "./ResizeHandles";
import { Toolbar } from "./Toolbar";
import { SelectionPanel } from "./SelectionPanel";
import {
  DEFAULT_CAMERA,
  MAX_ZOOM,
  MIN_ZOOM,
  type Camera,
  type CanvasMode,
} from "./types";

interface Props {
  store: CanvasStore;
  ws: WsClient;
  role: Role;
  selfUserId: string;
  remoteCursors: Map<string, { x: number; y: number }>;
  onSelectNode: (nodeId: string | null) => void;
  selectedNode: string | null;
  isReplay: boolean;
}

const STICKY_PALETTE = ["#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#ddd6fe"];

export function Canvas({
  store,
  ws,
  role,
  remoteCursors,
  onSelectNode,
  selectedNode,
  isReplay,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodes = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.nodesArray(),
  );
  const visibleNodes = nodes.filter((n) => !n.deleted);

  const [mode, setMode] = useState<CanvasMode>("select");
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [drag, setDrag] = useState<{
    id: string;
    startX: number;
    startY: number;
    mouseStartX: number;
    mouseStartY: number;
  } | null>(null);
  const [pan, setPan] = useState<{
    startX: number;
    startY: number;
    cameraStart: Camera;
  } | null>(null);
  const [creating, setCreating] = useState<{
    id: string;
    kind: "shape" | "drawing";
    x0: number;
    y0: number;
  } | null>(null);
  const [denyToast, setDenyToast] = useState<string | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const canEdit = role !== "viewer" && !isReplay;

  // -- screen <-> world coordinates --
  const screenToWorld = useCallback(
    (sx: number, sy: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (sx - rect.left - camera.x) / camera.zoom,
        y: (sy - rect.top - camera.y) / camera.zoom,
      };
    },
    [camera],
  );

  // -- RBAC denial flash --
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<string>;
      setDenyToast(ce.detail);
      window.setTimeout(() => setDenyToast(null), 1800);
    };
    window.addEventListener("ligma-rbac-denied", handler);
    return () => window.removeEventListener("ligma-rbac-denied", handler);
  }, []);

  // -- keyboard: tool shortcuts, space-pan, delete, esc --
  useEffect(() => {
    function isEditingText(): boolean {
      const t = document.activeElement;
      if (!t) return false;
      const tag = t.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || (t as HTMLElement).isContentEditable;
    }

    function down(e: KeyboardEvent) {
      if (e.code === "Space" && !isEditingText()) {
        if (!spaceHeld) setSpaceHeld(true);
        e.preventDefault();
        return;
      }
      if (isEditingText()) return;
      const k = e.key.toLowerCase();
      if (k === "v") setMode("select");
      else if (k === "s") setMode("sticky");
      else if (k === "r") setMode("rect");
      else if (k === "o") setMode("ellipse");
      else if (k === "a") setMode("arrow");
      else if (k === "p") setMode("pen");
      else if (k === "escape") {
        setMode("select");
        onSelectNode(null);
      } else if ((k === "delete" || k === "backspace") && selectedNode && canEdit) {
        ws.emitOp(EventKind.NODE_DELETED, selectedNode, {});
        onSelectNode(null);
      }
    }
    function up(e: KeyboardEvent) {
      if (e.code === "Space") setSpaceHeld(false);
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [spaceHeld, selectedNode, canEdit, ws, onSelectNode]);

  // -- wheel zoom around cursor --
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      // Zoom only with ctrl/cmd or pinch (deltaY with ctrl); otherwise pan.
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        setCamera((c) => {
          const factor = Math.exp(-e.deltaY * 0.0015);
          const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.zoom * factor));
          // Keep the world point under cursor stable.
          const wx = (sx - c.x) / c.zoom;
          const wy = (sy - c.y) / c.zoom;
          return { x: sx - wx * nextZoom, y: sy - wy * nextZoom, zoom: nextZoom };
        });
      } else {
        setCamera((c) => ({ x: c.x - e.deltaX, y: c.y - e.deltaY, zoom: c.zoom }));
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // -- pointer handling --
  function onSurfacePointerDown(ev: React.PointerEvent) {
    // Pan with middle button or space-held.
    if (ev.button === 1 || (ev.button === 0 && spaceHeld)) {
      setPan({ startX: ev.clientX, startY: ev.clientY, cameraStart: camera });
      (ev.target as Element).setPointerCapture?.(ev.pointerId);
      return;
    }
    if (ev.button !== 0) return;

    const w = screenToWorld(ev.clientX, ev.clientY);

    if (mode === "select") {
      onSelectNode(null);
      return;
    }

    if (!canEdit) {
      setDenyToast("Viewer cannot create");
      window.setTimeout(() => setDenyToast(null), 1500);
      return;
    }

    if (mode === "sticky") {
      const id = `n_${uuid().slice(0, 8)}`;
      const fill = STICKY_PALETTE[Math.floor(Math.random() * STICKY_PALETTE.length)]!;
      ws.emitOp(EventKind.NODE_CREATED, id, {
        kind: "sticky",
        x: w.x - 100,
        y: w.y - 70,
        w: 200,
        h: 140,
        fill,
        text: "",
      });
      onSelectNode(id);
      setMode("select");
      return;
    }

    if (mode === "rect" || mode === "ellipse" || mode === "arrow") {
      const id = `n_${uuid().slice(0, 8)}`;
      const shape: ShapeVariant =
        mode === "rect" ? "rect" : mode === "ellipse" ? "ellipse" : "arrow";
      ws.emitOp(EventKind.NODE_CREATED, id, {
        kind: "shape",
        shape,
        x: w.x,
        y: w.y,
        w: 1,
        h: 1,
        fill: mode === "arrow" ? "transparent" : "#1e293b",
        stroke: "#94a3b8",
      });
      setCreating({ id, kind: "shape", x0: w.x, y0: w.y });
      onSelectNode(id);
      return;
    }

    if (mode === "pen") {
      const id = `n_${uuid().slice(0, 8)}`;
      ws.emitOp(EventKind.NODE_CREATED, id, {
        kind: "drawing",
        x: w.x,
        y: w.y,
        w: 1,
        h: 1,
        fill: "transparent",
        stroke: "#e6edf3",
      });
      setCreating({ id, kind: "drawing", x0: w.x, y0: w.y });
      // Start a stroke list buffer locally; we'll emit one STROKE_APPENDED on pointerup
      // with all points (single immutable event per spec).
      pendingStrokePoints.current = [{ x: 0, y: 0 }];
    }
  }

  const pendingStrokePoints = useRef<Array<{ x: number; y: number }>>([]);

  // RAF-throttled emit helpers — at most one event per animation frame.
  // Drag and resize fire on every mousemove (often >60Hz on trackpads); without
  // throttling the server gets DoS'd by our own keystrokes.
  const moveEmit = useMemo(
    () =>
      rafThrottle<{ id: string; x: number; y: number }>(({ id, x, y }) => {
        ws.emitOp(EventKind.NODE_MOVED, id, { x, y });
      }),
    [ws],
  );
  const resizeEmit = useMemo(
    () =>
      rafThrottle<{ id: string; w: number; h: number }>(({ id, w, h }) => {
        ws.emitOp(EventKind.NODE_RESIZED, id, { w, h });
      }),
    [ws],
  );

  function onSurfacePointerMove(ev: React.PointerEvent) {
    if (pan) {
      const dx = ev.clientX - pan.startX;
      const dy = ev.clientY - pan.startY;
      setCamera({
        x: pan.cameraStart.x + dx,
        y: pan.cameraStart.y + dy,
        zoom: pan.cameraStart.zoom,
      });
      return;
    }

    const w = screenToWorld(ev.clientX, ev.clientY);
    ws.presence(w);

    if (drag && canEdit) {
      const nx = w.x - drag.mouseStartX + drag.startX;
      const ny = w.y - drag.mouseStartY + drag.startY;
      // Local-first: update the store immediately so the dragged node tracks
      // the cursor with zero latency. The server echo of our own emitOp will
      // be suppressed by the WS client's localClientMsgIds tracking.
      store.applyLocalMutation({ node_id: drag.id, x: nx, y: ny });
      moveEmit.call({ id: drag.id, x: nx, y: ny });
      return;
    }

    if (creating && canEdit) {
      if (creating.kind === "shape") {
        const nw = Math.max(1, Math.abs(w.x - creating.x0));
        const nh = Math.max(1, Math.abs(w.y - creating.y0));
        const nx = Math.min(w.x, creating.x0);
        const ny = Math.min(w.y, creating.y0);
        store.applyLocalMutation({ node_id: creating.id, x: nx, y: ny, w: nw, h: nh });
        resizeEmit.call({ id: creating.id, w: nw, h: nh });
        if (nx !== creating.x0 || ny !== creating.y0) {
          moveEmit.call({ id: creating.id, x: nx, y: ny });
        }
      } else if (creating.kind === "drawing") {
        // Pen: only buffer points locally. We render them via a transient
        // overlay and emit ONE STROKE_APPENDED + ONE final NODE_RESIZED at
        // pointerup — no per-move event spam.
        const localX = w.x - creating.x0;
        const localY = w.y - creating.y0;
        pendingStrokePoints.current.push({ x: localX, y: localY });
        // Live local resize so the SVG container grows; no network traffic.
        const minX = Math.min(0, ...pendingStrokePoints.current.map((p) => p.x));
        const minY = Math.min(0, ...pendingStrokePoints.current.map((p) => p.y));
        const maxX = Math.max(...pendingStrokePoints.current.map((p) => p.x));
        const maxY = Math.max(...pendingStrokePoints.current.map((p) => p.y));
        const width = Math.max(2, maxX - minX);
        const height = Math.max(2, maxY - minY);
        store.applyLocalMutation({ node_id: creating.id, w: width, h: height });
        // Repaint the stroke preview by bumping a counter; cheap.
        setDrawingPaintTick((t) => t + 1);
      }
    }
  }

  // Forces a re-render of the in-progress pen stroke preview.
  const [, setDrawingPaintTick] = useState(0);

  function onSurfacePointerUp(ev: React.PointerEvent) {
    if (pan) {
      setPan(null);
      (ev.target as Element).releasePointerCapture?.(ev.pointerId);
    }
    if (drag) {
      // Flush any pending throttled emit so the final position lands.
      moveEmit.flush();
      setDrag(null);
    }
    if (creating) {
      if (creating.kind === "drawing" && pendingStrokePoints.current.length > 1) {
        // Emit the final bbox + the entire stroke as a single immutable event.
        const pts = pendingStrokePoints.current;
        const minX = Math.min(0, ...pts.map((p) => p.x));
        const minY = Math.min(0, ...pts.map((p) => p.y));
        const maxX = Math.max(...pts.map((p) => p.x));
        const maxY = Math.max(...pts.map((p) => p.y));
        const width = Math.max(2, maxX - minX);
        const height = Math.max(2, maxY - minY);
        ws.emitOp(EventKind.NODE_RESIZED, creating.id, { w: width, h: height });
        ws.emitOp(EventKind.STROKE_APPENDED, creating.id, {
          points: pts,
          stroke: "#e6edf3",
          strokeWidth: 2,
        });
      }
      if (creating.kind === "shape") {
        moveEmit.flush();
        resizeEmit.flush();
      }
      pendingStrokePoints.current = [];
      setCreating(null);
      if (creating.kind === "shape" || creating.kind === "drawing") setMode("select");
    }
  }

  function onNodePointerDown(ev: React.PointerEvent, n: NodeState) {
    if (mode !== "select") return;
    ev.stopPropagation();
    onSelectNode(n.node_id);
    if (!canEdit) return;
    const w = screenToWorld(ev.clientX, ev.clientY);
    setDrag({
      id: n.node_id,
      startX: n.x,
      startY: n.y,
      mouseStartX: w.x,
      mouseStartY: w.y,
    });
  }

  function resetView() {
    setCamera(DEFAULT_CAMERA);
  }

  const surfaceCursor =
    pan || spaceHeld
      ? "grabbing"
      : mode === "select"
        ? "default"
        : mode === "pen"
          ? "crosshair"
          : "crosshair";

  return (
    <div
      ref={containerRef}
      className="canvas-cell"
      style={{
        background:
          "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)",
        backgroundSize: `${20 * camera.zoom}px ${20 * camera.zoom}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
        cursor: surfaceCursor,
        touchAction: "none",
      }}
      onPointerDown={onSurfacePointerDown}
      onPointerMove={onSurfacePointerMove}
      onPointerUp={onSurfacePointerUp}
    >
      <Toolbar mode={mode} setMode={setMode} disabled={!canEdit} zoom={camera.zoom} resetView={resetView} />

      {/* World layer — everything inside is in world coords; the layer is
          translated + scaled by the camera. */}
      <div
        className="world"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transformOrigin: "0 0",
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
        }}
      >
        {visibleNodes.map((n) => (
          <NodeView
            key={n.node_id}
            node={n}
            store={store}
            ws={ws}
            selected={selectedNode === n.node_id}
            canEdit={canEdit}
            mode={mode}
            camera={camera}
            containerRef={containerRef}
            onPointerDown={(e) => onNodePointerDown(e, n)}
          />
        ))}
      </div>

      {/* Cursor overlay — drawn in screen space, but cursor.{x,y} is in world
          coords, so we map back. */}
      <div className="cursor-overlay">
        {Array.from(remoteCursors.entries()).map(([uid, c]) => {
          const sx = c.x * camera.zoom + camera.x;
          const sy = c.y * camera.zoom + camera.y;
          return (
            <div
              key={uid}
              className="remote-cursor"
              style={{ left: sx, top: sy, background: hashColor(uid), color: "white" }}
            >
              ▲ {uid.replace("u_", "")}
            </div>
          );
        })}
      </div>

      <SelectionPanel
        store={store}
        ws={ws}
        selected={selectedNode}
        disabled={!canEdit}
        onDelete={() => onSelectNode(null)}
      />

      {denyToast && <div className="rbac-toast">⚠ {denyToast}</div>}
    </div>
  );
}

interface NodeViewProps {
  node: NodeState;
  store: CanvasStore;
  ws: WsClient;
  selected: boolean;
  canEdit: boolean;
  mode: CanvasMode;
  camera: Camera;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onPointerDown: (e: React.PointerEvent) => void;
}

const NodeView = memo(NodeViewImpl, (prev, next) => {
  // Skip re-render if nothing this view cares about changed.
  if (prev.node !== next.node) {
    // Compare the fields NodeView actually uses.
    const a = prev.node;
    const b = next.node;
    if (
      a.x !== b.x ||
      a.y !== b.y ||
      a.w !== b.w ||
      a.h !== b.h ||
      a.fill !== b.fill ||
      a.stroke !== b.stroke ||
      a.deleted !== b.deleted ||
      a.strokes !== b.strokes ||
      a.intent !== b.intent ||
      a.shape !== b.shape ||
      a.kind !== b.kind
    ) {
      return false;
    }
  }
  return (
    prev.selected === next.selected &&
    prev.canEdit === next.canEdit &&
    prev.mode === next.mode &&
    prev.camera === next.camera &&
    prev.store === next.store &&
    prev.ws === next.ws &&
    prev.containerRef === next.containerRef &&
    prev.onPointerDown === next.onPointerDown
  );
});

function NodeViewImpl({
  node,
  store,
  ws,
  selected,
  canEdit,
  mode,
  camera,
  containerRef,
  onPointerDown,
}: NodeViewProps) {
  const stickyStyle: React.CSSProperties = {
    position: "absolute",
    left: node.x,
    top: node.y,
    width: node.w,
    height: node.h,
    background: node.kind === "sticky" ? node.fill : "transparent",
    borderRadius: node.kind === "sticky" ? 8 : 0,
    boxShadow: selected
      ? "0 0 0 2px #6366f1"
      : node.kind === "sticky"
        ? "0 6px 16px rgba(0,0,0,0.3)"
        : "none",
    color: "#1f2937",
    fontSize: 13,
    cursor: mode === "select" ? "grab" : "default",
    userSelect: "none",
    overflow: "visible",
  };

  return (
    <div style={stickyStyle} onPointerDown={onPointerDown}>
      {node.kind === "sticky" && (
        <div style={{ padding: 10, width: "100%", height: "100%" }}>
          <StickyTextarea nodeId={node.node_id} store={store} ws={ws} disabled={!canEdit} />
        </div>
      )}
      {node.kind === "shape" && <ShapeNode node={node} />}
      {node.kind === "drawing" && <DrawingNode node={node} />}

      {node.intent && (
        <div
          className="intent-badge show"
          style={{
            left: node.w - 10,
            top: 0,
            position: "absolute",
            background: INTENT_BADGE_COLOR[node.intent.label as IntentLabel],
            color: "white",
          }}
        >
          {INTENT_BADGE_ICON[node.intent.label as IntentLabel]} {node.intent.label} ·{" "}
          {(node.intent.score * 100).toFixed(0)}%
        </div>
      )}

      {selected && (
        <ResizeHandles
          node={node}
          store={store}
          ws={ws}
          camera={camera}
          containerRef={containerRef}
          disabled={!canEdit}
        />
      )}
    </div>
  );
}

function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const palette = ["#3b82f6", "#a855f7", "#ec4899", "#f59e0b", "#10b981", "#06b6d4"];
  return palette[Math.abs(h) % palette.length]!;
}
