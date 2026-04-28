import type { NodeState } from "./store";

interface Props {
  node: NodeState;
}

export function DrawingNode({ node }: Props) {
  const strokes = node.strokes ?? [];
  // The drawing's bounding box is node.w × node.h; stroke points are stored
  // in node-local coords (relative to node x,y).
  return (
    <svg
      width={node.w}
      height={node.h}
      viewBox={`0 0 ${node.w} ${node.h}`}
      style={{ pointerEvents: "none" }}
    >
      {strokes.map((s, i) => {
        if (s.points.length === 0) return null;
        const d = s.points
          .map((p, j) => `${j === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
          .join(" ");
        return (
          <path
            key={i}
            d={d}
            stroke={s.stroke}
            strokeWidth={s.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        );
      })}
    </svg>
  );
}
