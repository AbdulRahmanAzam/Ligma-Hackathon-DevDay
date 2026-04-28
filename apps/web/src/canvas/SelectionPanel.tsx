import { EventKind } from "@ligma/shared";
import type { CanvasStore } from "./store";
import type { WsClient } from "../sync/ws-client";

const FILL_PALETTE = [
  "#fde68a", // amber
  "#bbf7d0", // green
  "#bfdbfe", // blue
  "#fbcfe8", // pink
  "#ddd6fe", // violet
  "#fed7aa", // orange
  "#e0e7ff", // indigo-50
  "#fecaca", // red
];

interface Props {
  store: CanvasStore;
  ws: WsClient;
  selected: string | null;
  disabled: boolean;
  onDelete: () => void;
}

export function SelectionPanel({ store, ws, selected, disabled, onDelete }: Props) {
  if (!selected) return null;
  const node = store.snapshot().nodes.get(selected);
  if (!node || node.deleted) return null;

  function pickColor(fill: string): void {
    if (disabled || !selected) return;
    ws.emitOp(EventKind.NODE_RESTYLED, selected, { fill });
  }

  function delNode(): void {
    if (disabled || !selected) return;
    ws.emitOp(EventKind.NODE_DELETED, selected, {});
    onDelete();
  }

  return (
    <div className="selection-panel">
      <div className="sp-row">
        <span className="sp-label">{node.kind}{node.shape ? ` · ${node.shape}` : ""}</span>
        <span className="sp-meta">seq {node.last_seq}</span>
      </div>
      <div className="sp-row swatches">
        {FILL_PALETTE.map((c) => (
          <button
            key={c}
            className={`swatch ${node.fill === c ? "active" : ""}`}
            style={{ background: c }}
            disabled={disabled}
            onClick={() => pickColor(c)}
            title={c}
          />
        ))}
      </div>
      <div className="sp-row">
        <button className="sp-danger" disabled={disabled} onClick={delNode}>
          Delete (Del)
        </button>
      </div>
    </div>
  );
}
