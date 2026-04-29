/**
 * Thin wrapper around the DigitalOcean GenAI / OpenAI-compatible chat endpoint.
 * Adds:
 *  - 10s timeout
 *  - exponential-backoff retry for transient (5xx + network) errors
 *  - typed error class so route handlers can map to HTTP status codes
 */
import type { DOAIResponse } from "./types.js";

export class DOApiError extends Error {
  status: number;
  detail: string;
  retriable: boolean;

  constructor(status: number, detail: string, retriable = false) {
    super(`DigitalOcean API error ${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
    this.retriable = retriable;
  }
}

export interface ChatCompletionParams {
  endpoint: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  max_tokens?: number;
  timeoutMs?: number;
  maxAttempts?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;

export async function callChatCompletion(
  params: ChatCompletionParams,
): Promise<DOAIResponse> {
  const {
    endpoint,
    apiKey,
    model,
    messages,
    temperature = 0.4,
    max_tokens = 2000,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = params;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, temperature, max_tokens }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const detail = await res.text().catch(() => "unknown");
        const retriable = res.status >= 500;
        // 401/403 are not retriable; 429 is rate-limit (let caller decide).
        if (!retriable || attempt === maxAttempts) {
          throw new DOApiError(res.status, detail, retriable);
        }
        lastErr = new DOApiError(res.status, detail, retriable);
        await sleep(backoffMs(attempt));
        continue;
      }

      return (await res.json()) as DOAIResponse;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DOApiError && !err.retriable) throw err;
      lastErr = err;
      if (attempt === maxAttempts) break;
      await sleep(backoffMs(attempt));
    }
  }

  if (lastErr instanceof DOApiError) throw lastErr;
  throw new DOApiError(
    0,
    lastErr instanceof Error ? lastErr.message : String(lastErr),
    true,
  );
}

function backoffMs(attempt: number): number {
  // 250ms, 500ms, 1000ms ...
  return 250 * Math.pow(2, attempt - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
