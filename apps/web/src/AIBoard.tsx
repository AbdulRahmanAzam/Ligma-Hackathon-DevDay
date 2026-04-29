/**
 * AI Board — full-screen modal where a Lead can browse every task on the
 * canvas and run AI explanations / diagram generation against any one of
 * them. Provides a clear, discoverable entry point for the MCP feature.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  GitBranch,
  Loader2,
  X,
  Search,
  CheckCircle2,
  AlertCircle,
  Crown,
  Pencil,
  Eye,
  Plus,
  Clipboard,
  History,
} from "lucide-react";
import type { Editor, TLShape, TLShapeId } from "tldraw";
import {
  createDiagramNode,
  createExplanationNode,
  emitErrorToast,
  emitToast,
  requestDiagram,
  requestExplanation,
  type MCPDiagram,
  type MCPExplanation,
} from "./mcp-integration";
import { markdownToHTML } from "./ai-summary";

interface Props {
  editor: Editor | null;
  roomId: string;
  open: boolean;
  onClose: () => void;
}

interface CanvasTaskRow {
  id: TLShapeId;
  text: string;
  type: string;
  authorName: string;
  authorRole: string;
  intent: string;
}

type Mode = "explain" | "diagram";

interface HistoryEntry {
  id: string;
  taskId: TLShapeId;
  taskLabel: string;
  mode: Mode;
  result: MCPExplanation | MCPDiagram;
  ts: string;
}

function flattenRichText(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return "";
  const obj = node as Record<string, unknown>;
  if (typeof obj.text === "string") return obj.text;
  if (Array.isArray(obj.content)) return obj.content.map(flattenRichText).join(" ");
  return "";
}

function readShapeText(_editor: Editor, shape: TLShape): string {
  const props = shape.props as { text?: unknown; richText?: unknown };
  if (typeof props.text === "string" && props.text.trim()) return props.text.trim();
  if (props.richText) {
    const txt = flattenRichText(props.richText).trim();
    if (txt) return txt;
  }
  return "";
}

function listCanvasTasks(editor: Editor): CanvasTaskRow[] {
  const rows: CanvasTaskRow[] = [];
  for (const shape of editor.getCurrentPageShapes()) {
    const text = readShapeText(editor, shape);
    if (!text) continue;
    const meta = (shape.meta ?? {}) as Record<string, unknown>;
    if (meta.kind === "ai-explanation" || meta.kind === "ai-diagram") continue;
    rows.push({
      id: shape.id,
      text,
      type: shape.type,
      authorName: typeof meta.authorName === "string" ? meta.authorName : "Unknown",
      authorRole: typeof meta.authorRole === "string" ? meta.authorRole : "Contributor",
      intent: typeof meta.intent === "string" ? meta.intent : "reference",
    });
  }
  return rows;
}

function RoleIcon({ role }: { role: string }) {
  if (role === "Lead") return <Crown size={11} />;
  if (role === "Contributor") return <Pencil size={11} />;
  return <Eye size={11} />;
}

export function AIBoard({ editor, roomId, open, onClose }: Props) {
  const [tasks, setTasks] = useState<CanvasTaskRow[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<TLShapeId | null>(null);
  const [mode, setMode] = useState<Mode>("explain");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HistoryEntry | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Refresh task list whenever the modal opens or canvas content changes.
  useEffect(() => {
    if (!open || !editor) return;
    const refresh = () => setTasks(listCanvasTasks(editor));
    refresh();
    const off = editor.store.listen(refresh, { source: "all", scope: "document" });
    return () => off();
  }, [open, editor]);

  // Keep selected id valid.
  useEffect(() => {
    if (!selected) return;
    if (!tasks.some((t) => t.id === selected)) setSelected(null);
  }, [tasks, selected]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) =>
        t.text.toLowerCase().includes(q) ||
        t.authorName.toLowerCase().includes(q) ||
        t.intent.toLowerCase().includes(q),
    );
  }, [filter, tasks]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selected) ?? null,
    [selected, tasks],
  );

  async function run() {
    if (!editor || !selectedTask || busy) return;
    setBusy(true);
    emitToast("info", `Generating ${mode}…`, 1800);
    try {
      const data =
        mode === "explain"
          ? await requestExplanation(selectedTask.id, roomId)
          : await requestDiagram(selectedTask.id, roomId);
      const entry: HistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        taskId: selectedTask.id,
        taskLabel: selectedTask.text.slice(0, 60),
        mode,
        result: data,
        ts: new Date().toISOString(),
      };
      setResult(entry);
      setHistory((h) => [entry, ...h].slice(0, 12));
      emitToast("success", `${mode === "explain" ? "Explanation" : "Diagram"} ready.`, 2400);
    } catch (err) {
      emitErrorToast(err);
    } finally {
      setBusy(false);
    }
  }

  function addToCanvas() {
    if (!editor || !result || !selectedTask) return;
    if (result.mode === "explain") {
      const id = createExplanationNode(editor, selectedTask.id, result.result as MCPExplanation);
      if (id) emitToast("success", "Explanation card added to the canvas.", 2400);
    } else {
      const id = createDiagramNode(editor, selectedTask.id, result.result as MCPDiagram);
      if (id) emitToast("success", "Diagram card added to the canvas.", 2400);
    }
  }

  async function copyResult() {
    if (!result) return;
    const text =
      result.mode === "explain"
        ? (result.result as MCPExplanation).explanation
        : (result.result as MCPDiagram).mermaid;
    try {
      await navigator.clipboard.writeText(text);
      emitToast("success", "Copied to clipboard.", 2200);
    } catch {
      emitToast("error", "Copy failed.", 2200);
    }
  }

  if (!open) return null;

  const explanationHTML =
    result?.mode === "explain"
      ? markdownToHTML((result.result as MCPExplanation).explanation)
      : "";
  const diagramText =
    result?.mode === "diagram" ? (result.result as MCPDiagram).mermaid : "";

  return (
    <div className="aiboard-backdrop" onClick={onClose}>
      <div
        className="aiboard-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="aiboard-header">
          <div className="aiboard-title">
            <span className="aiboard-icon-wrap">
              <Sparkles size={18} />
            </span>
            <div>
              <h2>AI Board</h2>
              <small>Pick a task → run Explain or Generate Diagram. Lead-only.</small>
            </div>
          </div>
          <button
            type="button"
            className="aiboard-close"
            onClick={onClose}
            aria-label="Close AI Board"
          >
            <X size={18} />
          </button>
        </header>

        <div className="aiboard-body">
          {/* ---------- Left column: tasks ---------- */}
          <aside className="aiboard-tasks">
            <div className="aiboard-search">
              <Search size={14} />
              <input
                type="text"
                placeholder="Search tasks, authors, intents…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div className="aiboard-task-meta">
              {tasks.length} task{tasks.length === 1 ? "" : "s"} on this canvas
              {filter ? ` · ${filtered.length} match${filtered.length === 1 ? "" : "es"}` : ""}
            </div>
            <ul className="aiboard-task-list">
              {filtered.length === 0 && (
                <li className="aiboard-empty">
                  {tasks.length === 0
                    ? "No tasks yet. Add a sticky note, decision, or question on the canvas first."
                    : "No tasks match your search."}
                </li>
              )}
              {filtered.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`aiboard-task ${selected === t.id ? "active" : ""}`}
                    onClick={() => setSelected(t.id)}
                  >
                    <span className={`aiboard-task-intent intent-${t.intent}`}>
                      {t.intent}
                    </span>
                    <span className="aiboard-task-text">{t.text}</span>
                    <span className="aiboard-task-author">
                      <RoleIcon role={t.authorRole} />
                      {t.authorName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* ---------- Right column: action + result ---------- */}
          <section className="aiboard-stage">
            <div className="aiboard-stage-controls">
              <div className="aiboard-mode-toggle" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "explain"}
                  className={`aiboard-mode-btn ${mode === "explain" ? "active" : ""}`}
                  onClick={() => setMode("explain")}
                >
                  <Sparkles size={14} /> Explain
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "diagram"}
                  className={`aiboard-mode-btn ${mode === "diagram" ? "active" : ""}`}
                  onClick={() => setMode("diagram")}
                >
                  <GitBranch size={14} /> Diagram
                </button>
              </div>

              <button
                type="button"
                className="aiboard-run-btn"
                onClick={run}
                disabled={!selectedTask || busy}
              >
                {busy ? (
                  <>
                    <Loader2 size={14} className="mcp-spin" /> Working…
                  </>
                ) : (
                  <>
                    <Sparkles size={14} /> Run {mode}
                  </>
                )}
              </button>
            </div>

            {!selectedTask && (
              <div className="aiboard-placeholder">
                <Sparkles size={28} />
                <h3>Pick a task on the left</h3>
                <p>
                  Choose any sticky note, question, or decision from the canvas.
                  The AI will use the surrounding tasks as context.
                </p>
              </div>
            )}

            {selectedTask && !result && !busy && (
              <div className="aiboard-target">
                <div className="aiboard-target-head">
                  <span className={`aiboard-task-intent intent-${selectedTask.intent}`}>
                    {selectedTask.intent}
                  </span>
                  <span className="aiboard-task-author">
                    <RoleIcon role={selectedTask.authorRole} />
                    {selectedTask.authorName}
                  </span>
                </div>
                <p className="aiboard-target-text">{selectedTask.text}</p>
                <p className="aiboard-hint">
                  Click <strong>Run {mode}</strong> to call the AI. The response
                  will appear here and you can add it to the canvas in one click.
                </p>
              </div>
            )}

            {busy && (
              <div className="aiboard-loading">
                <Loader2 size={28} className="mcp-spin" />
                <p>Thinking… contacting the AI service.</p>
              </div>
            )}

            {!busy && result && (
              <div className="aiboard-result">
                <div className="aiboard-result-head">
                  <h3>
                    {result.mode === "explain" ? (
                      <>
                        <Sparkles size={16} /> Explanation
                      </>
                    ) : (
                      <>
                        <GitBranch size={16} /> Diagram ·{" "}
                        {(result.result as MCPDiagram).diagramType}
                      </>
                    )}
                  </h3>
                  <div className="aiboard-result-actions">
                    <button type="button" onClick={copyResult} title="Copy to clipboard">
                      <Clipboard size={14} /> Copy
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={addToCanvas}
                      title="Add this card to the canvas next to the source task"
                    >
                      <Plus size={14} /> Add to canvas
                    </button>
                  </div>
                </div>

                {result.mode === "explain" ? (
                  <div
                    className="aiboard-markdown"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: explanationHTML }}
                  />
                ) : (
                  <pre className="aiboard-mermaid">{diagramText}</pre>
                )}

                <small className="aiboard-result-foot">
                  Generated {new Date(result.ts).toLocaleString()}
                  {result.result.model ? ` · ${result.result.model}` : ""}
                  {result.mode === "explain" && (result.result as MCPExplanation).cached
                    ? " · cached"
                    : ""}
                </small>
              </div>
            )}

            {history.length > 0 && (
              <div className="aiboard-history">
                <h4>
                  <History size={13} /> Recent
                </h4>
                <ul>
                  {history.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        className={result?.id === h.id ? "active" : ""}
                        onClick={() => {
                          setResult(h);
                          setSelected(h.taskId);
                          setMode(h.mode);
                        }}
                      >
                        <span className={`aiboard-history-mode ${h.mode}`}>
                          {h.mode === "explain" ? (
                            <Sparkles size={11} />
                          ) : (
                            <GitBranch size={11} />
                          )}
                          {h.mode}
                        </span>
                        <span className="aiboard-history-label">{h.taskLabel}</span>
                        <span className="aiboard-history-time">
                          {new Date(h.ts).toLocaleTimeString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Topbar entry-point button. Renders only for Lead users with MCP configured. */
export function AIBoardButton({
  isLead,
  configured,
  onClick,
}: {
  isLead: boolean;
  configured: boolean;
  onClick: () => void;
}) {
  if (!isLead) return null;
  return (
    <button
      type="button"
      className={`ai-board-btn ${configured ? "" : "disabled"}`}
      onClick={configured ? onClick : undefined}
      title={
        configured
          ? "Open the AI Board to explain tasks or generate diagrams"
          : "AI features are not configured. Set DO_AI_* env vars on the server."
      }
      disabled={!configured}
    >
      {configured ? <Sparkles size={14} /> : <AlertCircle size={14} />}
      <span>AI Board</span>
      {!configured && <span className="ai-board-pill">setup</span>}
      {configured && (
        <span className="ai-board-dot" aria-hidden="true">
          <CheckCircle2 size={11} />
        </span>
      )}
    </button>
  );
}
