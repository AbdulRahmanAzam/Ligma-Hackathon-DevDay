import type { CanvasMode } from "./types";

interface Props {
  mode: CanvasMode;
  setMode: (m: CanvasMode) => void;
  disabled: boolean;
  zoom: number;
  resetView: () => void;
}

const TOOLS: Array<{ id: CanvasMode; label: string; key: string }> = [
  { id: "select", label: "↖ Select", key: "V" },
  { id: "sticky", label: "▢ Sticky", key: "S" },
  { id: "rect", label: "□ Rect", key: "R" },
  { id: "ellipse", label: "○ Ellipse", key: "O" },
  { id: "arrow", label: "→ Arrow", key: "A" },
  { id: "pen", label: "✎ Pen", key: "P" },
];

export function Toolbar({ mode, setMode, disabled, zoom, resetView }: Props) {
  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool-btn ${mode === t.id ? "active" : ""}`}
          onClick={() => setMode(t.id)}
          disabled={disabled && t.id !== "select"}
          title={`${t.label} (${t.key})`}
        >
          {t.label}
        </button>
      ))}
      <div className="toolbar-spacer" />
      <span className="zoom-label">{Math.round(zoom * 100)}%</span>
      <button className="tool-btn ghost" onClick={resetView} title="Reset view">
        Reset
      </button>
    </div>
  );
}
