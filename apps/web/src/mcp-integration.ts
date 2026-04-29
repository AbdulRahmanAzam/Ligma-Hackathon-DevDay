/**
 * Frontend MCP integration — helpers used by the Board UI to ask the server
 * for AI explanations and Mermaid diagrams, and to add the resulting cards
 * to the tldraw canvas.
 *
 * Restricted to Lead users; the App is responsible for hiding the entry
 * points for non-Leads.
 */
import { createShapeId, toRichText } from "tldraw";
import type { Editor, TLShapeId } from "tldraw";
import { resolveApiUrl } from "./auth-api";

export interface MCPExplanation {
  taskId: string;
  explanation: string;
  relatedTaskIds: string[];
  cached: boolean;
  generatedAt: string;
  model?: string;
  tokensUsed?: number;
}

export interface MCPDiagram {
  taskId: string;
  diagramType: "flowchart" | "graph" | "timeline";
  mermaid: string;
  nodeCount: number;
  generatedAt: string;
  model?: string;
}

export interface MCPChatReply {
  reply: string;
  generatedAt: string;
  model?: string;
  tokensUsed?: number;
}

const EXPLAIN_TIMEOUT_MS = 15_000;
const DIAGRAM_TIMEOUT_MS = 20_000;
const CHAT_TIMEOUT_MS = 20_000;

export type MCPErrorCode =
  | "config_missing"
  | "rate_limited"
  | "service_unavailable"
  | "insufficient_context"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "timeout"
  | "unknown";

export class MCPError extends Error {
  code: MCPErrorCode;
  status: number;
  retryAfter?: number;

  constructor(code: MCPErrorCode, status: number, message: string, retryAfter?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function getToken(): string | null {
  return window.localStorage.getItem("ligma.token");
}

function mapStatusToCode(status: number): MCPErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 503) return "config_missing";
  if (status === 502 || status === 500) return "service_unavailable";
  return "unknown";
}

function userMessageFor(code: MCPErrorCode, fallback: string): string {
  switch (code) {
    case "config_missing":
      return "AI features are not configured. Contact your administrator.";
    case "rate_limited":
      return "Too many requests. Please wait a moment and try again.";
    case "service_unavailable":
      return "AI service temporarily unavailable. Please try again later.";
    case "insufficient_context":
      return "This task needs more details for AI explanation.";
    case "forbidden":
      return "AI features are only available to Lead users.";
    case "unauthorized":
      return "Your session has expired. Please sign in again.";
    case "not_found":
      return "That task could not be found on the canvas.";
    case "timeout":
      return "The AI service took too long to respond. Try again.";
    default:
      return fallback || "Something went wrong with the AI request.";
  }
}

async function postJson<T>(
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  const token = getToken();
  if (!token) {
    throw new MCPError("unauthorized", 401, "Sign in to use AI features.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(resolveApiUrl(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = "";
      try {
        const data = (await res.json()) as { message?: string; retryAfter?: number };
        detail = data.message ?? "";
        const code = mapStatusToCode(res.status);
        throw new MCPError(code, res.status, userMessageFor(code, detail), data.retryAfter);
      } catch (err) {
        if (err instanceof MCPError) throw err;
        const code = mapStatusToCode(res.status);
        throw new MCPError(code, res.status, userMessageFor(code, detail));
      }
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof MCPError) throw err;
    if ((err as { name?: string }).name === "AbortError") {
      throw new MCPError("timeout", 0, userMessageFor("timeout", ""));
    }
    throw new MCPError(
      "unknown",
      0,
      err instanceof Error ? err.message : "Network error.",
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- Public API
export async function requestExplanation(
  taskId: string,
  roomId: string,
): Promise<MCPExplanation> {
  return postJson<MCPExplanation>(
    "/api/mcp/explain",
    { taskId, roomId, includeRelatedTasks: true },
    EXPLAIN_TIMEOUT_MS,
  );
}

export async function requestDiagram(
  taskId: string,
  roomId: string,
  diagramType?: "flowchart" | "graph" | "timeline",
): Promise<MCPDiagram> {
  return postJson<MCPDiagram>(
    "/api/mcp/diagram",
    { taskId, roomId, diagramType },
    DIAGRAM_TIMEOUT_MS,
  );
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export async function requestChat(
  roomId: string,
  prompt: string,
  history: ChatHistoryMessage[] = [],
): Promise<MCPChatReply> {
  return postJson<MCPChatReply>(
    "/api/mcp/chat",
    { roomId, prompt, history },
    CHAT_TIMEOUT_MS,
  );
}

export async function checkMCPHealth(): Promise<{ configured: boolean }> {
  try {
    const res = await fetch(resolveApiUrl("/api/mcp/health"));
    if (!res.ok) return { configured: false };
    const data = (await res.json()) as { configured?: boolean };
    return { configured: Boolean(data.configured) };
  } catch {
    return { configured: false };
  }
}

// -------------------------------------------------------- Canvas integration

/**
 * Add an AI explanation card to the canvas, anchored next to the source task.
 * Renders as a tldraw note shape with sparkle-styled meta so the existing
 * canvas layer recognises it.
 */
export function createExplanationNode(
  editor: Editor,
  sourceTaskId: TLShapeId,
  explanation: MCPExplanation,
): TLShapeId | null {
  const source = editor.getShape(sourceTaskId);
  if (!source) return null;

  const id = createShapeId();
  const baseX = (source.x ?? 0) + 360;
  const baseY = source.y ?? 0;

  editor.createShape({
    id,
    type: "note",
    x: baseX,
    y: baseY,
    props: {
      richText: toRichText(formatExplanationBody(explanation)),
      color: "violet",
      size: "m",
    },
    meta: {
      kind: "ai-explanation",
      sourceTaskId,
      generatedAt: explanation.generatedAt,
      model: explanation.model ?? "",
      authorName: "Ligma AI",
      authorRole: "Lead",
      intent: "reference",
      createdAt: explanation.generatedAt,
    },
  });

  // Draw a connector arrow from the source task to the explanation card.
  try {
    editor.createShape({
      id: createShapeId(),
      type: "arrow",
      x: 0,
      y: 0,
      props: {
        start: { x: 0, y: 0 },
        end: { x: 0, y: 0 },
      },
      meta: {
        kind: "ai-explanation-link",
        sourceTaskId,
        targetTaskId: id,
      },
    });
  } catch {
    // Arrow shape API differs across tldraw versions; the explanation note is
    // still useful without it.
  }

  return id;
}

/**
 * Add a Mermaid diagram card to the canvas as a text shape (the actual
 * Mermaid render lives in a floating overlay in App.tsx — this is just
 * the canvas-side anchor).
 */
export function createDiagramNode(
  editor: Editor,
  sourceTaskId: TLShapeId,
  diagram: MCPDiagram,
): TLShapeId | null {
  const source = editor.getShape(sourceTaskId);
  if (!source) return null;

  const id = createShapeId();
  const baseX = (source.x ?? 0) + 360;
  const baseY = (source.y ?? 0) + 280;

  const header = `📊 Diagram: ${diagram.diagramType} (${diagram.nodeCount} nodes)\n\n`;
  editor.createShape({
    id,
    type: "note",
    x: baseX,
    y: baseY,
    props: {
      richText: toRichText(header + diagram.mermaid),
      color: "blue",
      size: "m",
    },
    meta: {
      kind: "ai-diagram",
      sourceTaskId,
      diagramType: diagram.diagramType,
      generatedAt: diagram.generatedAt,
      model: diagram.model ?? "",
      authorName: "Ligma AI",
      authorRole: "Lead",
      intent: "reference",
      createdAt: diagram.generatedAt,
    },
  });
  return id;
}

function formatExplanationBody(explanation: MCPExplanation): string {
  const ts = new Date(explanation.generatedAt).toLocaleTimeString();
  const footer = `\n\n— Generated by AI · ${explanation.model ?? "model"} · ${ts}`;
  return `✨ AI Explanation\n\n${explanation.explanation}${footer}`;
}

// ------------------------------------------------------------------- Toasts
export interface ToastEvent {
  id: string;
  level: "info" | "success" | "error";
  message: string;
  durationMs: number;
}

type ToastListener = (toast: ToastEvent) => void;
const toastListeners = new Set<ToastListener>();

export function onToast(listener: ToastListener): () => void {
  toastListeners.add(listener);
  return () => toastListeners.delete(listener);
}

export function emitToast(
  level: ToastEvent["level"],
  message: string,
  durationMs = 5000,
): void {
  const ev: ToastEvent = {
    id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    level,
    message,
    durationMs,
  };
  toastListeners.forEach((l) => l(ev));
}

export function emitErrorToast(err: unknown): void {
  const message =
    err instanceof MCPError
      ? err.message
      : err instanceof Error
        ? err.message
        : "Something went wrong.";
  emitToast("error", message, 5000);
}
