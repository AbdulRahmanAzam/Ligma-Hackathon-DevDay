import type { FastifyInstance } from "fastify";
import { verifyToken } from "./auth.js";

type SummaryNode = {
  id: string;
  text: string;
  intent: string;
  score: number;
  source: "ai" | "regex";
  authorName: string;
  authorRole: string;
  createdAt: string;
};

type SummaryData = {
  roomId: string;
  generatedAt?: string;
  nodes: SummaryNode[];
  participants: Array<{ name: string; role: string; color: string }>;
  stats?: {
    totalNodes: number;
    actionItems: number;
    decisions: number;
    questions: number;
    references: number;
  };
};

type SummaryRequest = { summary: SummaryData };

type OpenAiLikeResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  output_text?: string;
  text?: string;
};

const DEFAULT_MODEL = "openai-gpt-5-mini";
const DEFAULT_ENDPOINT = "https://api.digitalocean.com/v2/ai/chat/completions";
const MAX_NODES = 200;
const MAX_TEXT = 280;

async function requireAuth(req: { headers: Record<string, unknown> }) {
  const auth = req.headers["authorization"];
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return null;
  return verifyToken(auth.slice(7));
}

function clampText(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, Math.max(0, maxLen - 3))}...`;
}

function buildPrompt(summary: SummaryData): string {
  const lines: string[] = [];
  lines.push(`Room: ${summary.roomId}`);
  lines.push(`GeneratedAt: ${summary.generatedAt ?? new Date().toISOString()}`);

  if (summary.participants?.length) {
    const roster = summary.participants
      .map((p) => `${p.name} (${p.role})`)
      .join(", ");
    lines.push(`Participants: ${roster}`);
  }

  if (summary.stats) {
    lines.push(
      `Stats: total=${summary.stats.totalNodes}, action=${summary.stats.actionItems}, decision=${summary.stats.decisions}, question=${summary.stats.questions}, reference=${summary.stats.references}`,
    );
  }

  lines.push("Nodes:");
  const nodes = summary.nodes.slice(0, MAX_NODES);
  for (const node of nodes) {
    const text = clampText(node.text.replace(/\s+/g, " ").trim(), MAX_TEXT);
    lines.push(
      `- [${node.intent}] ${text} (by ${node.authorName}, ${node.authorRole}, ${node.createdAt})`,
    );
  }

  return lines.join("\n");
}

function extractMarkdown(data: OpenAiLikeResponse | null): string | null {
  if (!data) return null;
  const choice = data.choices?.[0]?.message?.content;
  if (typeof choice === "string" && choice.trim()) return choice.trim();
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  if (typeof data.text === "string" && data.text.trim()) return data.text.trim();
  return null;
}

export function registerAiSummaryRoutes(app: FastifyInstance): void {
  app.post<{ Body: SummaryRequest }>("/api/ai/summary", async (req, reply) => {
    const claims = await requireAuth(req);
    if (!claims) return reply.code(401).send({ error: "unauthorized" });

    const apiKey = process.env.DO_AI_API_KEY;
    if (!apiKey) return reply.code(503).send({ error: "ai_not_configured" });

    const summary = req.body?.summary;
    if (!summary || typeof summary.roomId !== "string" || !Array.isArray(summary.nodes)) {
      return reply.code(400).send({ error: "invalid_payload" });
    }

    const endpoint = process.env.DO_AI_ENDPOINT ?? DEFAULT_ENDPOINT;
    const model = process.env.DO_AI_MODEL ?? DEFAULT_MODEL;

    const payload = {
      model,
      messages: [
        {
          role: "system",
          content:
            "You are LIGMA's AI summarizer. Return concise markdown with headings: Action Items, Decisions, Open Questions, References, Participants, and Session Stats. Use bullet lists. No extra prose.",
        },
        { role: "user", content: buildPrompt(summary) },
      ],
      temperature: 0.2,
      max_tokens: 900,
    };

    let raw = "";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      raw = await res.text();
      if (!res.ok) {
        app.log.warn({ status: res.status }, "[ai-summary] upstream error");
        return reply.code(502).send({ error: "ai_upstream_error" });
      }
    } catch (err) {
      app.log.warn({ err }, "[ai-summary] request failed");
      return reply.code(502).send({ error: "ai_request_failed" });
    }

    let data: OpenAiLikeResponse | null = null;
    try {
      data = JSON.parse(raw) as OpenAiLikeResponse;
    } catch {
      data = null;
    }

    const markdown = extractMarkdown(data);
    if (!markdown) {
      return reply.code(502).send({ error: "ai_empty_response" });
    }

    return reply.send({ markdown });
  });
}
