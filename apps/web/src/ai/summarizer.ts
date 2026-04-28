/**
 * Browser-side summarization pipeline (Xenova/distilbart-cnn-6-6) for the
 * AI Summary Export bonus feature (Card 3.9 / spec §5 Creative Features).
 *
 * Same constraint as the classifier: zero paid APIs, runs on-device, lazy
 * loaded so the model only downloads when the user clicks "Export brief".
 */

type SummarizerPipeline = (
  text: string,
  options?: { max_length?: number; min_length?: number },
) => Promise<Array<{ summary_text: string }>>;

let pipelinePromise: Promise<SummarizerPipeline> | null = null;

async function getPipeline(): Promise<SummarizerPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = import("@huggingface/transformers")
      .then((m) =>
        m.pipeline("summarization", "Xenova/distilbart-cnn-6-6", {
          progress_callback: (p: { status: string; progress?: number; file?: string }) => {
            if (p.status === "progress" && p.progress !== undefined) {
              window.dispatchEvent(
                new CustomEvent("ligma-summarizer-load", {
                  detail: { progress: p.progress, file: p.file },
                }),
              );
            }
            if (p.status === "ready") {
              window.dispatchEvent(new CustomEvent("ligma-summarizer-ready"));
            }
          },
        } as never),
      )
      .then((p) => p as unknown as SummarizerPipeline);
  }
  return pipelinePromise;
}

/** Best-effort one-line summary. Returns the first sentence on failure. */
export async function summarizeOne(text: string): Promise<string> {
  const trimmed = text.trim();
  if (trimmed.length < 30) return trimmed; // not worth running the model
  try {
    const p = await getPipeline();
    const out = await p(trimmed, { max_length: 30, min_length: 6 });
    const summary = out[0]?.summary_text?.trim();
    if (summary) return summary;
  } catch (err) {
    console.warn("[ligma] summarizer failed for one item:", err);
  }
  // Fallback: first sentence (or first ~80 chars).
  const m = trimmed.match(/^[^.!?]+[.!?]?/);
  return (m?.[0] ?? trimmed).slice(0, 100);
}

/** Run summarization on many items in parallel-bounded fashion. */
export async function summarizeMany(texts: string[], concurrency = 2): Promise<string[]> {
  const results: string[] = new Array(texts.length).fill("");
  let i = 0;
  async function worker() {
    while (i < texts.length) {
      const idx = i++;
      results[idx] = await summarizeOne(texts[idx]!);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, texts.length) }, worker);
  await Promise.all(workers);
  return results;
}

export function warmSummarizer(): void {
  void getPipeline();
}
