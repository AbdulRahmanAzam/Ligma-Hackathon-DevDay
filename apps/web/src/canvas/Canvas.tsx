import React, { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import {
  EventKind,
  INTENT_BADGE_COLOR,
  INTENT_BADGE_ICON,
  type IntentLabel,
  type Role,
} from "@ligma/shared";
import { type CanvasStore, useCanvasStore } from "./store";
import type { WsClient } from "../sync/ws-client";

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

const PALETTE = ["#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#ddd6fe"];

export function Canvas({
  store,
  ws,
  role,
  remoteCursors,
  onSelectNode,
  selectedNode,
  isReplay,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const nodes = useCanvasStore(store, (s) => Array.from(s.nodes.values()));
  const visibleNodes = nodes.filter((n) => !n.deleted);
  const [drag, setDrag] = useState<{
    id: string;
    dx: number;
    dy: number;
  } | null>(null);
  const [denyToast, setDenyToast] = useState<string | null>(null);

  const canEdit = role !== "viewer" && !isReplay;

  // Listen for rbac_denied broadcasts to flash a toast.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<string>;
      setDenyToast(ce.detail);
      window.setTimeout(() => setDenyToast(null), 1800);
    };
    window.addEventListener("ligma-rbac-denied", handler);
    return () => window.removeEventListener("ligma-rbac-denied", handler);
  }, []);

  function pageCoords(ev: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function onCanvasDoubleClick(ev: React.MouseEvent) {
    if (!canEdit) {
      setDenyToast("Viewer cannot create");
      window.setTimeout(() => setDenyToast(null), 1500);
      return;
    }
    const { x, y } = pageCoords(ev);
    const id = `n_${uuid().slice(0, 8)}`;
    const fill = PALETTE[Math.floor(Math.random() * PALETTE.length)]!;
    ws.emitOp(EventKind.NODE_CREATED, id, {
      kind: "sticky",
      x: x - 100,
      y: y - 70,
      w: 200,
      h: 140,
      fill,
      text: "",
    });
  }

  function onNodeMouseDown(ev: React.MouseEvent, nodeId: string) {
    ev.stopPropagation();
    onSelectNode(nodeId);
    if (!canEdit) return;
    const node = store.snapshot().nodes.get(nodeId);
    if (!node) return;
    const { x, y } = pageCoords(ev);
    setDrag({ id: nodeId, dx: x - node.x, dy: y - node.y });
  }

  function onCanvasMouseMove(ev: React.MouseEvent) {
    const { x, y } = pageCoords(ev);
    ws.presence({ x, y });
    if (drag && canEdit) {
      const node = store.snapshot().nodes.get(drag.id);
      if (!node) return;
      const nx = x - drag.dx;
      const ny = y - drag.dy;
      ws.emitOp(EventKind.NODE_MOVED, drag.id, { x: nx, y: ny });
    }
  }

  function onCanvasMouseUp() {
    setDrag(null);
  }

  function onTextEdit(nodeId: string, value: string) {
    if (!canEdit) return;
    const update = store.stickyText.edit(nodeId, (t) => {
      t.delete(0, t.length);
      t.insert(0, value);
    });
    ws.emitOp(EventKind.STICKY_TEXT_DELTA, nodeId, { yjs_update_b64: update });
  }

  return (
    <div
      ref={ref}
      className="canvas-cell"
      style={{ background: "#1c2233", cursor: canEdit ? "crosshair" : "not-allowed" }}
      onDoubleClick={onCanvasDoubleClick}
      onMouseMove={onCanvasMouseMove}
      onMouseUp={onCanvasMouseUp}
      onClick={() => onSelectNode(null)}
    >
      {visibleNodes.map((n) => (
        <div
          key={n.node_id}
          style={{
            position: "absolute",
            left: n.x,
            top: n.y,
            width: n.w,
            height: n.h,
            background: n.fill,
            borderRadius: 8,
            boxShadow:
              selectedNode === n.node_id
                ? "0 0 0 2px #6366f1, 0 8px 24px rgba(0,0,0,0.4)"
                : "0 6px 16px rgba(0,0,0,0.3)",
            padding: 10,
            color: "#1f2937",
            fontSize: 13,
            cursor: drag?.id === n.node_id ? "grabbing" : "grab",
            userSelect: drag ? "none" : "text",
          }}
          onMouseDown={(e) => onNodeMouseDown(e, n.node_id)}
        >
          <textarea
            data-node-id={n.node_id}
            value={n.text}
            onChange={(e) => onTextEdit(n.node_id, e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder={canEdit ? "Type your idea…" : ""}
            disabled={!canEdit}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              outline: "none",
              background: "transparent",
              resize: "none",
              fontFamily: "inherit",
              fontSize: 13,
              color: "#1f2937",
            }}
          />
          {n.intent && (
            <div
              className="intent-badge show"
              style={{
                left: n.w - 10,
                top: 0,
                position: "absolute",
                background: INTENT_BADGE_COLOR[n.intent.label as IntentLabel],
                color: "white",
              }}
            >
              {INTENT_BADGE_ICON[n.intent.label as IntentLabel]} {n.intent.label} ·{" "}
              {(n.intent.score * 100).toFixed(0)}%
            </div>
          )}
        </div>
      ))}

      <div className="cursor-overlay">
        {Array.from(remoteCursors.entries()).map(([uid, c]) => (
          <div
            key={uid}
            className="remote-cursor"
            style={{
              left: c.x,
              top: c.y,
              background: hashColor(uid),
              color: "white",
            }}
          >
            ▲ {uid.replace("u_", "")}
          </div>
        ))}
      </div>

      {denyToast && <div className="rbac-toast">⚠ {denyToast}</div>}
    </div>
  );
}

function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const palette = ["#3b82f6", "#a855f7", "#ec4899", "#f59e0b", "#10b981", "#06b6d4"];
  return palette[Math.abs(h) % palette.length]!;
}
