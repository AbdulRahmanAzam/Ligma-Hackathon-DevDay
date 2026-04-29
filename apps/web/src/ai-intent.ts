/**
 * AI Intent Classification Service
 * Uses @huggingface/transformers for browser-side zero-shot classification.
 * Falls back to regex heuristics if the model fails to load.
 */
import { pipeline, env } from '@huggingface/transformers'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type IntentLabel = 'action' | 'decision' | 'question' | 'reference'

export interface IntentResult {
  intent: IntentLabel
  score: number
  source: 'ai' | 'regex'
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const MODEL_ID = 'Xenova/nli-deberta-v3-xsmall'

const CANDIDATE_LABELS = ['action item', 'decision', 'open question', 'reference note'] as const

const LABEL_MAP: Record<string, IntentLabel> = {
  'action item': 'action',
  decision: 'decision',
  'open question': 'question',
  'reference note': 'reference',
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let classifierPipeline: any = null
let loadingPromise: Promise<void> | null = null
let modelReady = false
let modelFailed = false

const cache = new Map<string, IntentResult>()
const MAX_CACHE = 500

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Pre-download and warm-up the ONNX model. Safe to call multiple times. */
export async function preloadModel(
  onProgress?: (info: { status: string; progress: number }) => void,
): Promise<void> {
  if (modelReady || modelFailed) return
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    try {
      // Disable local model loading — always fetch from HF Hub / CDN
      env.allowLocalModels = false

      classifierPipeline = await pipeline(
        'zero-shot-classification',
        MODEL_ID,
        {
          progress_callback: (data: { status?: string; progress?: number }) => {
            if (onProgress && data) {
              onProgress({
                status: data.status ?? 'loading',
                progress: typeof data.progress === 'number' ? data.progress : 0,
              })
            }
          },
        },
      )
      modelReady = true
      console.info('[ai-intent] Model loaded successfully')
    } catch (err) {
      console.warn('[ai-intent] Model load failed — regex fallback active:', err)
      modelFailed = true
      modelReady = false
    }
  })()

  return loadingPromise
}

/** Returns true once the model is loaded and ready for inference. */
export function isModelReady(): boolean {
  return modelReady
}

/** Returns true if the model failed to load and we're in regex-only mode. */
export function isModelFailed(): boolean {
  return modelFailed
}

/**
 * Classify text intent. Returns cached result if available.
 * Uses AI model when ready, otherwise falls back to regex.
 */
export async function classifyIntentAI(text: string): Promise<IntentResult> {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length < 3) {
    return { intent: 'reference', score: 0.5, source: 'regex' }
  }

  const cacheKey = trimmed.toLowerCase()
  const cached = cache.get(cacheKey)
  if (cached) return cached

  // Try AI classification
  if (modelReady && classifierPipeline) {
    try {
      const result = await classifierPipeline(trimmed, [...CANDIDATE_LABELS], {
        multi_label: false,
      })

      const topLabel: string = result.labels[0] ?? 'reference note'
      const topScore: number = result.scores[0] ?? 0
      const intent = LABEL_MAP[topLabel] ?? 'reference'

      const intentResult: IntentResult = { intent, score: topScore, source: 'ai' }
      setCache(cacheKey, intentResult)
      return intentResult
    } catch (err) {
      console.warn('[ai-intent] Inference error — using regex fallback:', err)
    }
  }

  // Regex fallback
  const fallback = classifyIntentRegex(trimmed)
  setCache(cacheKey, fallback)
  return fallback
}

/**
 * Synchronous regex-based classification.
 * Used as immediate fallback and for the initial render before the model loads.
 */
export function classifyIntentRegex(text: string): IntentResult {
  const lower = text.toLowerCase()

  if (
    /\b(todo|action|assign|owner|follow.?up|next.?step|ship|build|fix|create|implement|task|must|need to|should)\b/.test(
      lower,
    )
  ) {
    return { intent: 'action', score: 0.7, source: 'regex' }
  }

  if (/\b(decision|decided|approved|chosen|final|agree|agreed|concluded|resolved|verdict)\b/.test(lower)) {
    return { intent: 'decision', score: 0.7, source: 'regex' }
  }

  if (text.includes('?') || /\b(question|unknown|open|clarify|risk|unsure|tbd|uncertain)\b/.test(lower)) {
    return { intent: 'question', score: 0.7, source: 'regex' }
  }

  return { intent: 'reference', score: 0.5, source: 'regex' }
}

/** Clear the classification cache (useful when switching rooms). */
export function clearIntentCache(): void {
  cache.clear()
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------
function setCache(key: string, value: IntentResult): void {
  cache.set(key, value)
  // Evict oldest entries when cache exceeds limit
  if (cache.size > MAX_CACHE) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
}
