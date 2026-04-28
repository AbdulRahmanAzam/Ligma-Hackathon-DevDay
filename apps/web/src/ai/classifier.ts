import { INTENT_HYPOTHESIS, INTENT_LABELS, INTENT_THRESHOLD, type IntentLabel } from "@ligma/shared";

type Pipeline = (
  text: string,
  candidate_labels: readonly string[],
  options: { hypothesis_template: string; multi_label?: boolean },
) => Promise<{ labels: string[]; scores: number[] }>;

let pipelinePromise: Promise<Pipeline> | null = null;

async function getPipeline(): Promise<Pipeline> {
  if (!pipelinePromise) {
    pipelinePromise = import("@huggingface/transformers")
      .then((m) =>
        // Xenova/nli-deberta-v3-base — meaningfully better than MobileBERT on
        // short text (~280 MB vs ~95 MB; first-load is slower but cached after).
        // The classifier API is identical, only the model id changes.
        m.pipeline("zero-shot-classification", "Xenova/nli-deberta-v3-base", {
          progress_callback: (p: { status: string; progress?: number; file?: string }) => {
            if (p.status === "progress" && p.progress !== undefined) {
              window.dispatchEvent(
                new CustomEvent("ligma-model-load", {
                  detail: { progress: p.progress, file: p.file },
                }),
              );
            }
            if (p.status === "ready") {
              window.dispatchEvent(new CustomEvent("ligma-model-ready"));
            }
          },
        } as never),
      )
      .then((p) => p as unknown as Pipeline);
  }
  return pipelinePromise;
}

export interface ClassifyResult {
  label: IntentLabel;
  score: number;
}

export async function classify(text: string): Promise<ClassifyResult | null> {
  const trimmed = text.trim();
  if (trimmed.length < 3) return null;
  const p = await getPipeline();
  const out = await p(trimmed, INTENT_LABELS, {
    hypothesis_template: INTENT_HYPOTHESIS,
    multi_label: false,
  });
  if (!out.labels.length) return null;
  const top = out.labels[0]!;
  const score = out.scores[0]!;
  if (score < INTENT_THRESHOLD) return null;
  return { label: top as IntentLabel, score };
}

export function warmModel(): void {
  void getPipeline();
}
