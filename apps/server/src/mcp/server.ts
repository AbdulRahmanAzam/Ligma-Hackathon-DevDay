/**
 * MCP server singleton — owns shared cache, rate limiter, metrics, and config.
 * Initialized once at server startup. All MCP route handlers go through this.
 */
import { ResponseCache } from "./cache.js";
import { RateLimiter } from "./rate-limiter.js";
import type {
  MCPConfig,
  ExplanationResponse,
  DiagramResponse,
  UsageStats,
} from "./types.js";

function loadConfig(): MCPConfig {
  const endpoint = process.env.DO_AI_ENDPOINT ?? "";
  const apiKey = process.env.DO_AI_API_KEY ?? "";
  const model = process.env.DO_AI_MODEL ?? "";

  return {
    endpoint,
    apiKey,
    model,
    cacheEnabled: (process.env.MCP_CACHE_ENABLED ?? "true").toLowerCase() !== "false",
    cacheTtlSeconds: Number(process.env.MCP_CACHE_TTL_SECONDS ?? 300),
    rateLimitPerMinute: Number(process.env.MCP_RATE_LIMIT_PER_MINUTE ?? 10),
    maxRelatedTasks: Number(process.env.MCP_MAX_RELATED_TASKS ?? 10),
    proximityRadius: Number(process.env.MCP_PROXIMITY_RADIUS ?? 500),
    configured: Boolean(endpoint && apiKey && model),
  };
}

export interface MetricsCounters {
  explanationRequests: number;
  explanationSuccess: number;
  explanationError: number;
  diagramRequests: number;
  diagramSuccess: number;
  diagramError: number;
  cacheHits: number;
  cacheMisses: number;
  rateLimitViolations: number;
  doApiCalls: number;
  durationsMs: number[]; // bounded ring of last N durations
}

const MAX_DURATION_SAMPLES = 500;

export class MCPServer {
  private config: MCPConfig;
  private cache: ResponseCache<ExplanationResponse | DiagramResponse>;
  private limiter: RateLimiter;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;
  private metrics: MetricsCounters = {
    explanationRequests: 0,
    explanationSuccess: 0,
    explanationError: 0,
    diagramRequests: 0,
    diagramSuccess: 0,
    diagramError: 0,
    cacheHits: 0,
    cacheMisses: 0,
    rateLimitViolations: 0,
    doApiCalls: 0,
    durationsMs: [],
  };
  private dailyUsage: UsageStats = {
    date: new Date().toISOString().slice(0, 10),
    explanationRequests: 0,
    diagramRequests: 0,
    successCount: 0,
    errorCount: 0,
    rateLimitViolations: 0,
    cacheHits: 0,
  };

  constructor() {
    this.config = loadConfig();
    this.cache = new ResponseCache(this.config.cacheTtlSeconds);
    this.limiter = new RateLimiter(this.config.rateLimitPerMinute);
  }

  async initialize(): Promise<void> {
    // Reload config from current env (test-friendly).
    this.config = loadConfig();
    this.cache = new ResponseCache(this.config.cacheTtlSeconds);
    this.limiter = new RateLimiter(this.config.rateLimitPerMinute);

    if (!this.config.configured) {
      console.warn(
        "[mcp] AI features disabled — set DO_AI_ENDPOINT, DO_AI_API_KEY, DO_AI_MODEL to enable.",
      );
    } else {
      console.info(
        `[mcp] initialized — model=${this.config.model} cache=${this.config.cacheEnabled} ` +
          `ttl=${this.config.cacheTtlSeconds}s rate=${this.config.rateLimitPerMinute}/min`,
      );
    }

    if (!this.cleanupTimer) {
      this.cleanupTimer = setInterval(() => this.cache.cleanup(), 60_000);
      // Allow node to exit even if this timer is still scheduled.
      this.cleanupTimer.unref?.();
    }

    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
    this.limiter.reset();
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isConfigured(): boolean {
    return this.config.configured;
  }

  getConfig(): MCPConfig {
    return this.config;
  }

  getCache(): ResponseCache<ExplanationResponse | DiagramResponse> {
    return this.cache;
  }

  getRateLimiter(): RateLimiter {
    return this.limiter;
  }

  getMetrics(): MetricsCounters {
    return this.metrics;
  }

  recordMetric(type: keyof Omit<MetricsCounters, "durationsMs">, value = 1): void {
    this.metrics[type] += value;
  }

  recordDuration(ms: number): void {
    if (this.metrics.durationsMs.length >= MAX_DURATION_SAMPLES) {
      this.metrics.durationsMs.shift();
    }
    this.metrics.durationsMs.push(ms);
  }

  getDailyUsage(): UsageStats {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyUsage.date !== today) {
      this.dailyUsage = {
        date: today,
        explanationRequests: 0,
        diagramRequests: 0,
        successCount: 0,
        errorCount: 0,
        rateLimitViolations: 0,
        cacheHits: 0,
      };
    }
    return this.dailyUsage;
  }
}

let instance: MCPServer | null = null;

export function getMCPServer(): MCPServer {
  if (!instance) instance = new MCPServer();
  return instance;
}

/** Test helper. */
export function resetMCPServer(): void {
  if (instance) void instance.shutdown();
  instance = null;
}
