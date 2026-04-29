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

    const systemPrompt = `You are an expert project manager and meeting facilitator. Your task is to transform raw brainstorming session data into a polished, professional executive summary.

Produce output in clean markdown with EXACTLY these sections in this order:

# [Session Title — derive from the content or use "Brainstorm Session"]
> Brief tagline capturing the essence of the session

## Executive Summary
Write 3-4 impactful sentences summarizing what was accomplished, key themes, and the overall direction the team is heading. Be specific and insightful.

## 📋 Action Items
List every action item as a checkbox. Format: - [ ] **[Task]** — *[Owner]* ([Role]), [Time]
If no action items, write: _No concrete action items were identified._

## ✅ Key Decisions
List each decision with brief rationale. Format: - **[Decision]** — [1-sentence context/impact]
If no decisions, write: _No formal decisions were recorded._

## ❓ Open Questions
Number each unresolved question. Add who raised it if known.
If none, write: _All questions were resolved during the session._

## 📎 References & Notes
List any reference materials, links, or background context mentioned.
If none, write: _No external references were cited._

## 📊 Session Analytics
Create a markdown table with these rows: Total nodes | Action items | Decisions | Open questions | References | Participants

## 👥 Participants
List each participant with their role in parentheses.

Rules:
- Be specific and actionable, not generic
- Infer context from the content when helpful
- Keep the tone professional but human
- Use markdown formatting consistently
- Do not add any text before the title or after the Participants section`;

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
          max_tokens: 3000,
          temperature: 0.4,
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
