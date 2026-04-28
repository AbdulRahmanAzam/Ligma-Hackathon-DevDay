import type { CanvasStore, NodeState } from "../canvas/store";
import { summarizeMany } from "./summarizer";

interface Buckets {
  actions: NodeState[];
  decisions: NodeState[];
  questions: NodeState[];
  references: NodeState[];
  unlabeled: NodeState[];
}

/**
 * Project the current store into the four spec intent buckets. The intent
 * comes from the per-node intent.labeled events that the IntentPipeline
 * emitted; if a node has no intent.labeled yet, it lands in 'unlabeled'.
 */
export function bucketize(store: CanvasStore): Buckets {
  const out: Buckets = {
    actions: [],
    decisions: [],
    questions: [],
    references: [],
    unlabeled: [],
  };
  for (const n of store.snapshot().nodes.values()) {
    if (n.deleted) continue;
    if (n.kind !== "sticky") continue;
    const text = store.stickyText.text(n.node_id).trim();
    if (!text) continue;
    const label = n.intent?.label;
    if (label === "action item") out.actions.push(n);
    else if (label === "decision") out.decisions.push(n);
    else if (label === "open question") out.questions.push(n);
    else if (label === "reference") out.references.push(n);
    else out.unlabeled.push(n);
  }
  return out;
}

function nodeText(store: CanvasStore, n: NodeState): string {
  return store.stickyText.text(n.node_id).trim();
}

/** Format an ISO-ish timestamp for the brief header. */
function nowIsoMin(): string {
  return new Date().toISOString().replace(/:\d\d\.\d+Z$/, "Z");
}

/** Generate a markdown brief from the current canvas state. */
export async function generateBrief(opts: {
  roomName: string;
  store: CanvasStore;
  onProgress?: (msg: string) => void;
}): Promise<string> {
  const { roomName, store, onProgress } = opts;
  const buckets = bucketize(store);

  onProgress?.("Summarizing action items...");
  const actionTexts = buckets.actions.map((n) => nodeText(store, n));
  const actionSums = await summarizeMany(actionTexts);

  onProgress?.("Summarizing decisions...");
  const decisionTexts = buckets.decisions.map((n) => nodeText(store, n));
  const decisionSums = await summarizeMany(decisionTexts);

  onProgress?.("Summarizing questions...");
  const questionTexts = buckets.questions.map((n) => nodeText(store, n));
  const questionSums = await summarizeMany(questionTexts);

  // References don't need summarization — we list them verbatim.
  const referenceTexts = buckets.references.map((n) => nodeText(store, n));

  const lines: string[] = [];
  lines.push(`# ${roomName} — Session Brief`);
  lines.push("");
  lines.push(`_Generated ${nowIsoMin()} by LIGMA._`);
  lines.push("");

  function section(title: string, items: string[], originals: NodeState[]): void {
    if (items.length === 0) return;
    lines.push(`## ${title}`);
    lines.push("");
    for (let i = 0; i < items.length; i++) {
      const summary = items[i]!;
      const node = originals[i]!;
      const score = node.intent?.score ? ` _(${(node.intent.score * 100).toFixed(0)}%)_` : "";
      lines.push(`- ${summary}${score}`);
    }
    lines.push("");
  }

  section("✅ Action Items", actionSums, buckets.actions);
  section("📌 Decisions", decisionSums, buckets.decisions);
  section("❓ Open Questions", questionSums, buckets.questions);

  if (referenceTexts.length > 0) {
    lines.push("## 📚 References");
    lines.push("");
    for (const t of referenceTexts) lines.push(`- ${t.slice(0, 200)}`);
    lines.push("");
  }

  if (buckets.unlabeled.length > 0) {
    lines.push("## 🗒 Unlabeled");
    lines.push("");
    lines.push(`_${buckets.unlabeled.length} sticky note(s) without intent classification._`);
    lines.push("");
  }

  if (
    buckets.actions.length +
      buckets.decisions.length +
      buckets.questions.length +
      buckets.references.length ===
    0
  ) {
    lines.push("_No labeled content in this room yet. Type into a sticky note and wait for the AI badge to appear._");
    lines.push("");
  }

  return lines.join("\n");
}

/** Trigger a download in the browser. */
export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
