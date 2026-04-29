/**
 * Generates a Mermaid diagram for a task and its related tasks.
 * Diagram type is auto-selected from the intent mix unless the caller forces it.
 */
import { callChatCompletion } from "./do-api-client.js";
import type { DiagramType, MCPConfig, TaskContext } from "./types.js";

const MAX_NODES = 20;

const SYSTEM_PROMPT = `You generate Mermaid diagrams that visualize the relationship between a task and its surrounding tasks on a whiteboard.

Output ONLY valid Mermaid syntax — no prose, no triple-backtick fences. The first line must be a valid Mermaid header (one of: \`flowchart LR\`, \`flowchart TD\`, \`graph LR\`, \`graph TD\`, \`timeline\`).

Hard limits:
- Maximum 20 nodes total.
- Use short, readable labels (≤ 6 words).
- Do not include any text outside the diagram.`;

export function analyzeDiagramType(ctx: TaskContext): DiagramType {
  const intents = [ctx.task.intent, ...ctx.relatedTasks.map((t) => t.intent)];
  const counts = intents.reduce<Record<string, number>>((acc, i) => {
    acc[i] = (acc[i] ?? 0) + 1;
    return acc;
  }, {});

  const total = intents.length || 1;
  const actionRatio = (counts.action ?? 0) / total;
  const decisionRatio = (counts.decision ?? 0) / total;

  if (decisionRatio > 0.4) return "flowchart";
  if (actionRatio > 0.5) return "flowchart";
  if (ctx.relatedTasks.length >= 6) return "graph";
  return "graph";
}

function fallbackMermaid(ctx: TaskContext, diagramType: DiagramType): string {
  const lines: string[] = [];
  if (diagramType === "timeline") {
    lines.push("timeline", `  title ${escapeLabel(ctx.roomName)}`);
    const all = [ctx.task, ...ctx.relatedTasks].slice(0, MAX_NODES);
    for (const t of all) {
      const day = t.createdAt.slice(0, 10);
      lines.push(`  ${day} : ${escapeLabel(truncate(t.text, 40))}`);
    }
    return lines.join("\n");
  }
  const header = diagramType === "flowchart" ? "flowchart LR" : "graph LR";
  lines.push(header);
  const safeId = (id: string) => id.replace(/[^A-Za-z0-9]/g, "").slice(0, 16) || "n";
  const main = `${safeId(ctx.task.id)}["${escapeLabel(truncate(ctx.task.text || "Task", 40))}"]`;
  lines.push(`  ${main}`);
  for (const t of ctx.relatedTasks.slice(0, MAX_NODES - 1)) {
    const node = `${safeId(t.id)}["${escapeLabel(truncate(t.text || t.intent, 40))}"]`;
    lines.push(`  ${node}`);
    lines.push(`  ${safeId(ctx.task.id)} --> ${safeId(t.id)}`);
  }
  return lines.join("\n");
}

function escapeLabel(text: string): string {
  return text.replace(/"/g, "'").replace(/[\r\n]+/g, " ");
}

function truncate(text: string, n: number): string {
  if (text.length <= n) return text;
  return text.slice(0, n - 1) + "…";
}

export function validateDiagram(mermaid: string): {
  valid: boolean;
  reason?: string;
  nodeCount: number;
} {
  const trimmed = mermaid.trim();
  if (!trimmed) return { valid: false, reason: "empty", nodeCount: 0 };
  const firstLine = trimmed.split(/\r?\n/, 1)[0]!.trim();
  const header =
    /^(flowchart|graph)\s+(LR|RL|TD|TB|BT)\s*$/i.test(firstLine) ||
    /^timeline\b/i.test(firstLine);
  if (!header) return { valid: false, reason: "missing_header", nodeCount: 0 };

  const nodeCount = countNodes(trimmed);
  if (nodeCount > MAX_NODES) {
    return { valid: false, reason: "too_many_nodes", nodeCount };
  }
  return { valid: true, nodeCount };
}

function countNodes(mermaid: string): number {
  // Heuristic: unique tokens that look like node ids on the LHS or RHS of arrows.
  const set = new Set<string>();
  const lines = mermaid.split(/\r?\n/);
  for (const line of lines) {
    const matches = line.match(/[A-Za-z_][A-Za-z0-9_]*(?=\s*[\["(]|\s*-->|\s*---)/g);
    if (!matches) continue;
    for (const m of matches) {
      if (
        m === "flowchart" ||
        m === "graph" ||
        m === "timeline" ||
        m === "title" ||
        m === "subgraph" ||
        m === "end"
      )
        continue;
      set.add(m);
    }
  }
  return set.size;
}

export interface DiagramResult {
  mermaid: string;
  nodeCount: number;
  diagramType: DiagramType;
  model: string;
}

export class DiagramGenerator {
  constructor(private cfg: MCPConfig) {}

  async generate(
    ctx: TaskContext,
    forced?: DiagramType,
  ): Promise<DiagramResult> {
    const diagramType = forced ?? analyzeDiagramType(ctx);

    const related = ctx.relatedTasks
      .slice(0, MAX_NODES - 1)
      .map((t, i) => `${i + 1}. [${t.intent}] "${truncate(t.text, 80)}"`)
      .join("\n");

    const userPrompt = `Diagram type: ${diagramType}
Room: "${ctx.roomName}"

TARGET TASK
- Intent: ${ctx.task.intent}
- Text: "${truncate(ctx.task.text, 80)}"

RELATED TASKS (${ctx.relatedTasks.length})
${related || "(none)"}

Generate a Mermaid ${diagramType} (max 20 nodes) that connects the target task with the related tasks. Output Mermaid syntax only.`;

    let mermaid = "";
    let model = this.cfg.model;
    try {
      const res = await callChatCompletion({
        endpoint: this.cfg.endpoint,
        apiKey: this.cfg.apiKey,
        model: this.cfg.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 1200,
      });
      mermaid = res.choices?.[0]?.message?.content?.trim() ?? "";
      model = res.model || this.cfg.model;
      // Strip stray code-fences if the model added them anyway.
      mermaid = mermaid
        .replace(/^```(?:mermaid)?\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
    } catch (err) {
      // Fall back to a deterministic local diagram so the UX still gets *something*.
      mermaid = "";
    }

    const v = validateDiagram(mermaid);
    if (!v.valid) {
      mermaid = fallbackMermaid(ctx, diagramType);
    }
    const final = validateDiagram(mermaid);
    return {
      mermaid,
      nodeCount: final.nodeCount,
      diagramType,
      model,
    };
  }
}
