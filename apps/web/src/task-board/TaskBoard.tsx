import { type TaskRow } from "@ligma/shared";

interface Props {
  tasks: Map<string, TaskRow>;
  onJump: (sourceNode: string) => void;
}

export function TaskBoard({ tasks, onJump }: Props) {
  const rows = Array.from(tasks.values()).sort((a, b) => b.updated_seq - a.updated_seq);

  return (
    <aside className="taskboard">
      <h2>Task Board</h2>
      <div style={{ fontSize: 12, color: "var(--ligma-fg-mute)", marginBottom: 12 }}>
        {rows.length === 0
          ? "Action items extracted from sticky text will appear here."
          : `${rows.length} task${rows.length === 1 ? "" : "s"}`}
      </div>
      {rows.map((t) => (
        <div key={t.task_id} className="task-row" onClick={() => onJump(t.source_node)}>
          <div className="title">{t.title}</div>
          <div className="meta">
            <span className="score">AI {(t.ai_score * 100).toFixed(0)}%</span>
            {" · "}
            <span>{t.status}</span>
            {" · seq "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{t.updated_seq}</span>
          </div>
        </div>
      ))}
    </aside>
  );
}
