/**
 * Builds explanation prompts for a task and calls the DO AI API to generate them.
 */
import { callChatCompletion } from "./do-api-client.js";
import type { MCPConfig, TaskContext } from "./types.js";

export interface ExplanationResult {
  explanation: string;
  model: string;
  tokensUsed: number;
}

const SYSTEM_PROMPT = `You are an expert facilitator helping a team understand a task on a collaborative whiteboard.

Given a target task and its surrounding context, write a clear, structured explanation in Markdown that includes:

## What this task means
A concise (2-3 sentence) restatement of the task in plain language.

## Why it matters
Connect the task to the goals of the room and the surrounding tasks.

## How it relates to nearby work
Reference specific related tasks by their text and explain the connection.

## Suggested next steps
Give 2-4 concrete, actionable bullet points the team can take.

Rules:
- Be specific and actionable, not generic.
- Prefer the team's vocabulary from the surrounding tasks.
- Keep the whole response under ~250 words.
- Use markdown formatting consistently.`;

export function buildExplanationPrompt(
  ctx: TaskContext,
): { system: string; user: string } {
  const related = ctx.relatedTasks
    .slice(0, 10)
    .map(
      (t) =>
        `- [${t.intent.toUpperCase()}] "${t.text}" — ${t.authorName} (${t.authorRole})`,
    )
    .join("\n");

  const participants =
    ctx.roomParticipants.map((p) => `${p.name} (${p.role})`).join(", ") || "Unknown";

  const user = `Room: "${ctx.roomName}"
Participants: ${participants}

TARGET TASK
- Intent: ${ctx.task.intent.toUpperCase()}
- Author: ${ctx.task.authorName} (${ctx.task.authorRole})
- Created: ${ctx.task.createdAt}
- Text: "${ctx.task.text}"

NEARBY TASKS (${ctx.relatedTasks.length})
${related || "(none nearby)"}

Please explain the target task using the structure above.`;

  return { system: SYSTEM_PROMPT, user };
}

export class AIExplainer {
  constructor(private cfg: MCPConfig) {}

  async generateExplanation(ctx: TaskContext): Promise<ExplanationResult> {
    const { system, user } = buildExplanationPrompt(ctx);

    const res = await callChatCompletion({
      endpoint: this.cfg.endpoint,
      apiKey: this.cfg.apiKey,
      model: this.cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
      max_tokens: 2000,
    });

    const content = res.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      throw new Error("AI returned an empty explanation");
    }

    return {
      explanation: content,
      model: res.model || this.cfg.model,
      tokensUsed: res.usage?.total_tokens ?? 0,
    };
  }
}
