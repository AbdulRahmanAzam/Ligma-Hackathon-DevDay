/**
 * Server-side LLM proxy for AI Summary generation.
 * Uses DigitalOcean GenAI (OpenAI-compatible) API.
 */
import type { FastifyInstance } from "fastify";
import { verifyToken } from "./auth.js";

const DO_AI_ENDPOINT = process.env.DO_AI_ENDPOINT || "";
const DO_AI_API_KEY = process.env.DO_AI_API_KEY || "";
const DO_AI_MODEL = process.env.DO_AI_MODEL || "";

async function requireAuth(req: { headers: Record<string, unknown> }) {
  const auth = req.headers["authorization"];
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return null;
  return verifyToken(auth.slice(7));
}

export function registerAiSummaryRoutes(app: FastifyInstance): void {
  app.post<{
    Body: {
      roomId: string;
      nodes: Array<{
        text: string;
        intent: string;
        authorName: string;
        authorRole: string;
        createdAt: string;
      }>;
      participants: Array<{ name: string; role: string }>;
    };
  }>("/api/ai/summary", async (req, reply) => {
    const claims = await requireAuth(req);
    if (!claims) return reply.code(401).send({ error: "unauthorized" });

    if (!DO_AI_API_KEY || !DO_AI_ENDPOINT) {
      return reply.code(503).send({
        error: "ai_not_configured",
        message: "DigitalOcean AI API not configured. Set DO_AI_ENDPOINT, DO_AI_API_KEY, DO_AI_MODEL env vars.",
      });
    }

    const { roomId, nodes, participants } = req.body;

    const systemPrompt = `You are a professional meeting summarizer. Given brainstorming session data, produce a polished executive summary in markdown. Structure it with these exact sections:

## Executive Summary
(2-3 sentence overview of the brainstorming session)

## 📋 Action Items
(checkbox list of all action items with owner attribution)

## ✅ Key Decisions
(bullet list of decisions with context)

## ❓ Open Questions
(numbered list of unresolved questions)

## 📎 References & Notes
(any reference material mentioned)

## 📊 Session Analytics
(stats table: total nodes, breakdown by intent, participant count)

Be concise, professional, and actionable. Use markdown formatting.`;

    const nodeList = nodes
      .map(
        (n) =>
          `- [${n.intent.toUpperCase()}] "${n.text}" — ${n.authorName} (${n.authorRole}), ${n.createdAt}`,
      )
      .join("\n");

    const userPrompt = `Brainstorming session for workspace "${roomId}":

Participants: ${participants.map((p) => `${p.name} (${p.role})`).join(", ") || "Unknown"}

Canvas Nodes (${nodes.length} total):
${nodeList || "(empty canvas)"}

Generate a structured, professional summary.`;

    try {
      const response = await fetch(DO_AI_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DO_AI_API_KEY}`,
        },
        body: JSON.stringify({
          model: DO_AI_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 2000,
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "unknown");
        app.log.error(`[ai-summary] LLM API error: ${response.status} ${errText}`);
        return reply.code(502).send({ error: "llm_error", detail: errText });
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        return reply.code(502).send({ error: "llm_empty" });
      }

      return { summary: content };
    } catch (err) {
      app.log.error(`[ai-summary] LLM fetch error: ${String(err)}`);
      return reply.code(502).send({ error: "llm_error", message: String(err) });
    }
  });
}
