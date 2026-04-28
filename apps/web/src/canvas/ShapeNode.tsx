import type { NodeState } from "./store";

interface Props {
  node: NodeState;
}

export function ShapeNode({ node }: Props) {
  if (node.shape === "ellipse") {
    return (
      <svg width={node.w} height={node.h} viewBox={`0 0 ${node.w} ${node.h}`}>
        <ellipse
          cx={node.w / 2}
          cy={node.h / 2}
          rx={Math.max(1, node.w / 2 - 2)}
          ry={Math.max(1, node.h / 2 - 2)}
          fill={node.fill}
          stroke={node.stroke}
          strokeWidth={2}
        />
      </svg>
    );
  }

  if (node.shape === "arrow") {
    const w = node.w;
    const h = node.h;
    // Arrow goes from (0, h/2) to (w, h/2) by default. Caller may set node.end
    // for a non-axis-aligned arrow; we just use a normalized horizontal arrow.
    const head = 12;
    const stroke = node.stroke;
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <defs>
          <marker
            id={`ah-${node.node_id}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth={head}
            markerHeight={head}
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
          </marker>
        </defs>
        <line
          x1={2}
          y1={h / 2}
          x2={w - 4}
          y2={h / 2}
          stroke={stroke}
          strokeWidth={3}
          strokeLinecap="round"
          markerEnd={`url(#ah-${node.node_id})`}
        />
      </svg>
    );
  }

  // Default: rectangle.
  return (
    <svg width={node.w} height={node.h} viewBox={`0 0 ${node.w} ${node.h}`}>
      <rect
        x={1}
        y={1}
        width={Math.max(1, node.w - 2)}
        height={Math.max(1, node.h - 2)}
        rx={6}
        fill={node.fill}
        stroke={node.stroke}
        strokeWidth={2}
      />
    </svg>
  );
}
