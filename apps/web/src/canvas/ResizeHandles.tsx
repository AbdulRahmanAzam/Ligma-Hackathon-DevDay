import { EventKind } from "@ligma/shared";
import type { CanvasStore, NodeState } from "./store";
import type { WsClient } from "../sync/ws-client";
import type { Camera } from "./types";

interface Props {
  node: NodeState;
  store: CanvasStore;
  ws: WsClient;
  camera: Camera;
  containerRef: React.RefObject<HTMLDivElement | null>;
  disabled: boolean;
}

const MIN_W = 60;
const MIN_H = 40;

const HANDLES = [
  { id: "nw", cursor: "nwse-resize", x: 0, y: 0 },
  { id: "n", cursor: "ns-resize", x: 0.5, y: 0 },
  { id: "ne", cursor: "nesw-resize", x: 1, y: 0 },
  { id: "e", cursor: "ew-resize", x: 1, y: 0.5 },
  { id: "se", cursor: "nwse-resize", x: 1, y: 1 },
  { id: "s", cursor: "ns-resize", x: 0.5, y: 1 },
  { id: "sw", cursor: "nesw-resize", x: 0, y: 1 },
  { id: "w", cursor: "ew-resize", x: 0, y: 0.5 },
] as const;

export function ResizeHandles({ node, ws, camera, containerRef, disabled }: Props) {
  if (disabled) return null;

  function onPointerDown(handleId: string, ev: React.PointerEvent) {
    ev.stopPropagation();
    ev.preventDefault();
    const startW = node.w;
    const startH = node.h;
    const startX = node.x;
    const startY = node.y;
    const rect = containerRef.current?.getBoundingClientRect();
    const startMouseWorldX = rect
      ? (ev.clientX - rect.left - camera.x) / camera.zoom
      : ev.clientX;
    const startMouseWorldY = rect
      ? (ev.clientY - rect.top - camera.y) / camera.zoom
      : ev.clientY;

    function move(e: PointerEvent) {
      const r = containerRef.current?.getBoundingClientRect();
      if (!r) return;
      const wx = (e.clientX - r.left - camera.x) / camera.zoom;
      const wy = (e.clientY - r.top - camera.y) / camera.zoom;
      const dx = wx - startMouseWorldX;
      const dy = wy - startMouseWorldY;

      let nx = startX;
      let ny = startY;
      let nw = startW;
      let nh = startH;

      if (handleId.includes("e")) nw = Math.max(MIN_W, startW + dx);
      if (handleId.includes("s")) nh = Math.max(MIN_H, startH + dy);
      if (handleId.includes("w")) {
        const wnext = Math.max(MIN_W, startW - dx);
        nx = startX + (startW - wnext);
        nw = wnext;
      }
      if (handleId.includes("n")) {
        const hnext = Math.max(MIN_H, startH - dy);
        ny = startY + (startH - hnext);
        nh = hnext;
      }
      // Throttle to ~60fps via simple coalescing on requestAnimationFrame.
      ws.emitOp(EventKind.NODE_RESIZED, node.node_id, { w: nw, h: nh });
      if (nx !== startX || ny !== startY) {
        ws.emitOp(EventKind.NODE_MOVED, node.node_id, { x: nx, y: ny });
      }
    }

    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <>
      {HANDLES.map((h) => (
        <div
          key={h.id}
          className="resize-handle"
          style={{
            left: h.x * node.w - 5,
            top: h.y * node.h - 5,
            cursor: h.cursor,
          }}
          onPointerDown={(e) => onPointerDown(h.id, e)}
        />
      ))}
    </>
  );
}
