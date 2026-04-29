/**
 * Floating "AI Actions" affordance for Lead users.
 *
 * - Shown only when:
 *     · userRole === 'Lead'
 *     · MCP is configured server-side
 *     · exactly one shape is selected (so the action has a target)
 * - Two buttons: "Explain with AI" and "Generate Diagram".
 * - Renders a stack of toast notifications subscribed via mcp-integration.onToast.
 * - Renders an inline modal preview of the most recent explanation/diagram so
 *   the user gets immediate feedback before/while the canvas card is added.
 */
import { useEffect, useState } from "react";
import { Sparkles, GitBranch, Loader2, X, AlertCircle, CheckCircle2, Info } from "lucide-react";
import type { Editor, TLShapeId } from "tldraw";
import {
  createDiagramNode,
  createExplanationNode,
  emitErrorToast,
  emitToast,
  onToast,
  requestDiagram,
  requestExplanation,
  type MCPDiagram,
  type MCPExplanation,
  type ToastEvent,
} from "./mcp-integration";

interface Props {
  editor: Editor | null;
  roomId: string;
  isLead: boolean;
  mcpConfigured: boolean;
  selectedShapeId: TLShapeId | null;
}

type Busy = "explain" | "diagram" | null;

export function MCPPanel({ editor, roomId, isLead, mcpConfigured, selectedShapeId }: Props) {
  const [busy, setBusy] = useState<Busy>(null);
  const [toasts, setToasts] = useState<ToastEvent[]>([]);
  const [preview, setPreview] = useState<
    | { kind: "explanation"; data: MCPExplanation }
    | { kind: "diagram"; data: MCPDiagram }
    | null
  >(null);

  useEffect(() => {
    return onToast((t) => {
      setToasts((prev) => [...prev, t]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, t.durationMs);
    });
  }, []);

  async function handleExplain() {
    if (!editor || !selectedShapeId || busy) return;
    setBusy("explain");
    emitToast("info", "Generating explanation…", 2000);
    try {
      const result = await requestExplanation(selectedShapeId, roomId);
      const newId = createExplanationNode(editor, selectedShapeId, result);
      if (newId) emitToast("success", "Explanation added to the canvas.", 3000);
      setPreview({ kind: "explanation", data: result });
    } catch (err) {
      emitErrorToast(err);
    } finally {
      setBusy(null);
    }
  }

  async function handleDiagram() {
    if (!editor || !selectedShapeId || busy) return;
    setBusy("diagram");
    emitToast("info", "Generating diagram…", 2000);
    try {
      const result = await requestDiagram(selectedShapeId, roomId);
      const newId = createDiagramNode(editor, selectedShapeId, result);
      if (newId) emitToast("success", "Diagram added to the canvas.", 3000);
      setPreview({ kind: "diagram", data: result });
    } catch (err) {
      emitErrorToast(err);
    } finally {
      setBusy(null);
    }
  }

  const showActions = isLead && mcpConfigured && !!selectedShapeId;

  return (
    <>
      {showActions && (
        <div className="mcp-actions" role="toolbar" aria-label="AI actions">
          <span className="mcp-actions-label">
            <Sparkles size={14} /> AI actions
          </span>
          <button
            type="button"
            className="mcp-action-btn"
            onClick={handleExplain}
            disabled={busy !== null}
            title="Generate an AI explanation for the selected task"
          >
            {busy === "explain" ? <Loader2 size={14} className="mcp-spin" /> : <Sparkles size={14} />}
            <span>Explain with AI</span>
          </button>
          <button
            type="button"
            className="mcp-action-btn"
            onClick={handleDiagram}
            disabled={busy !== null}
            title="Generate a diagram of how the selected task connects to nearby tasks"
          >
            {busy === "diagram" ? <Loader2 size={14} className="mcp-spin" /> : <GitBranch size={14} />}
            <span>Generate Diagram</span>
          </button>
        </div>
      )}

      {/* Tooltip when feature exists but not configured */}
      {isLead && !mcpConfigured && selectedShapeId && (
        <div className="mcp-actions mcp-actions-disabled">
          <Info size={14} />
          <span>AI features are not configured. Set DO_AI_* env vars on the server.</span>
        </div>
      )}

      {/* Toasts */}
      <div className="mcp-toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`mcp-toast mcp-toast-${t.level}`}>
            {t.level === "error" ? (
              <AlertCircle size={16} />
            ) : t.level === "success" ? (
              <CheckCircle2 size={16} />
            ) : (
              <Info size={16} />
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Inline preview modal */}
      {preview && (
        <div className="mcp-preview-backdrop" onClick={() => setPreview(null)}>
          <div className="mcp-preview" onClick={(e) => e.stopPropagation()}>
            <header>
              <h3>
                {preview.kind === "explanation" ? (
                  <>
                    <Sparkles size={16} /> AI Explanation
                  </>
                ) : (
                  <>
                    <GitBranch size={16} /> Diagram · {preview.data.diagramType}
                  </>
                )}
              </h3>
              <button type="button" className="mcp-preview-close" onClick={() => setPreview(null)}>
                <X size={16} />
              </button>
            </header>
            <div className="mcp-preview-body">
              {preview.kind === "explanation" ? (
                <pre className="mcp-explanation-text">{preview.data.explanation}</pre>
              ) : (
                <pre className="mcp-diagram-text">{preview.data.mermaid}</pre>
              )}
            </div>
            <footer>
              <small>
                Generated {new Date(preview.data.generatedAt).toLocaleString()}
                {preview.data.model ? ` · ${preview.data.model}` : ""}
              </small>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
