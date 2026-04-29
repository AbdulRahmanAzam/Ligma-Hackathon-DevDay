/**
 * HTTP API for the MCP (AI Explainer) feature.
 *
 *   POST /api/mcp/explain   — generate an explanation for a task (Lead only)
 *   POST /api/mcp/diagram   — generate a Mermaid diagram for a task (Lead only)
 *   GET  /api/mcp/health    — readiness/configuration check
 *   GET  /api/mcp/metrics   — prometheus-style counters
 *   GET  /api/mcp/stats     — daily usage statistics
 *
 * All endpoints validate input, enforce per-user rate limits, and use the
 * shared cache from the MCP singleton.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { getMCPServer } from "../mcp/server.js";
import { authorizeLeadInRoom } from "../mcp/auth.js";
import { extractTaskContext } from "../mcp/context-extractor.js";
import { AIExplainer } from "../mcp/explainer.js";
import { DiagramGenerator } from "../mcp/diagram.js";
import { DOApiError } from "../mcp/do-api-client.js";
import type {
  DiagramRequest,
  DiagramResponse,
  DiagramType,
  ExplanationRequest,
  ExplanationResponse,
} from "../mcp/types.js";

interface ErrorBody {
  error: string;
  message: string;
  reason?: string;
  retryAfter?: number;
}

function send(reply: FastifyReply, status: number, body: ErrorBody) {
  return reply.code(status).send(body);
}

function configError(reply: FastifyReply): FastifyReply {
  return send(reply, 503, {
    error: "Service Unavailable",
    message:
      "AI explanation features are not configured. Set DO_AI_ENDPOINT, DO_AI_API_KEY, and DO_AI_MODEL.",
  });
}

function mapDOError(err: DOApiError, action: "explanation" | "diagram"): {
  status: number;
  body: ErrorBody;
} {
  if (err.status === 429) {
    return {
      status: 429,
      body: {
        error: "Too Many Requests",
        message: "DigitalOcean API rate limit exceeded. Please try again shortly.",
      },
    };
  }
  if (err.status === 401 || err.status === 403) {
    return {
      status: 502,
      body: {
        error: "Bad Gateway",
        message: "AI service authentication failed. Contact your administrator.",
      },
    };
  }
  return {
    status: 500,
    body: {
      error: "Internal Server Error",
      message: `Failed to generate ${action}: ${err.detail || err.message}`,
    },
  };
}

function explanationCacheKey(roomId: string, taskId: string): string {
  return `explain:${roomId}:${taskId}`;
}

function diagramCacheKey(roomId: string, taskId: string, type: string): string {
  return `diagram:${roomId}:${taskId}:${type}`;
}

export function registerMCPRoutes(app: FastifyInstance): void {
  const mcp = getMCPServer();

  // ---------------------------------------------------------------- /health
  app.get("/api/mcp/health", async () => ({
    ok: true,
    initialized: mcp.isInitialized(),
    configured: mcp.isConfigured(),
    cacheStats: mcp.getCache().stats(),
  }));

  // --------------------------------------------------------------- /metrics
  app.get("/api/mcp/metrics", async (_req, reply) => {
    const m = mcp.getMetrics();
    const cache = mcp.getCache().stats();
    const lines = [
      `mcp_explanation_requests_total ${m.explanationRequests}`,
      `mcp_explanation_requests_success ${m.explanationSuccess}`,
      `mcp_explanation_requests_error ${m.explanationError}`,
      `mcp_diagram_requests_total ${m.diagramRequests}`,
      `mcp_diagram_requests_success ${m.diagramSuccess}`,
      `mcp_diagram_requests_error ${m.diagramError}`,
      `mcp_cache_hits_total ${cache.hits}`,
      `mcp_cache_misses_total ${cache.misses}`,
      `mcp_cache_size ${cache.size}`,
      `mcp_rate_limit_violations_total ${m.rateLimitViolations}`,
      `mcp_do_api_calls_total ${m.doApiCalls}`,
    ];
    if (m.durationsMs.length) {
      const sorted = [...m.durationsMs].sort((a, b) => a - b);
      const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      lines.push(`mcp_explanation_duration_seconds_p50 ${(p(0.5)! / 1000).toFixed(3)}`);
      lines.push(`mcp_explanation_duration_seconds_p95 ${(p(0.95)! / 1000).toFixed(3)}`);
    }
    reply.header("content-type", "text/plain; version=0.0.4");
    return lines.join("\n");
  });

  // ----------------------------------------------------------------- /stats
  app.get("/api/mcp/stats", async () => mcp.getDailyUsage());

  // --------------------------------------------------------------- /explain
  app.post<{ Body: ExplanationRequest }>(
    "/api/mcp/explain",
    async (req, reply) => {
      const startedAt = Date.now();
      const route = "/api/mcp/explain";
      const body = (req.body ?? {}) as Partial<ExplanationRequest>;

      // ----- input validation
      if (!body.taskId || typeof body.taskId !== "string") {
        return send(reply, 400, {
          error: "Bad Request",
          message: "taskId is required and must be a string.",
        });
      }
      if (!body.roomId || typeof body.roomId !== "string") {
        return send(reply, 400, {
          error: "Bad Request",
          message: "roomId is required and must be a string.",
        });
      }

      // ----- authn / authz
      const auth = await authorizeLeadInRoom(req, body.roomId, route);
      if (!auth.ok) {
        return send(reply, auth.status, {
          error: auth.status === 401 ? "Unauthorized" : "Forbidden",
          message: auth.message,
          reason: auth.reason,
        });
      }

      // ----- configuration
      if (!mcp.isConfigured()) {
        return configError(reply);
      }

      mcp.recordMetric("explanationRequests");
      mcp.getDailyUsage().explanationRequests++;

      // ----- rate limit
      const limit = mcp.getRateLimiter().recordRequest(auth.claims.sub);
      if (!limit.allowed) {
        mcp.recordMetric("rateLimitViolations");
        mcp.getDailyUsage().rateLimitViolations++;
        reply.header("retry-after", String(limit.retryAfterSec));
        return send(reply, 429, {
          error: "Too Many Requests",
          message: `Too many explanation requests. Try again in ${limit.retryAfterSec}s.`,
          retryAfter: limit.retryAfterSec,
        });
      }

      // ----- cache
      const cacheKey = explanationCacheKey(body.roomId, body.taskId);
      if (mcp.getConfig().cacheEnabled) {
        const cached = mcp.getCache().get(cacheKey) as ExplanationResponse | undefined;
        if (cached && "explanation" in cached) {
          mcp.recordMetric("cacheHits");
          mcp.getDailyUsage().cacheHits++;
          return reply.code(200).send(cached);
        }
        mcp.recordMetric("cacheMisses");
      }

      // ----- context extraction
      let ctx;
      try {
        ctx = await extractTaskContext(body.taskId, body.roomId, {
          proximityRadius: mcp.getConfig().proximityRadius,
          maxRelated: mcp.getConfig().maxRelatedTasks,
        });
      } catch (err) {
        mcp.recordMetric("explanationError");
        mcp.getDailyUsage().errorCount++;
        return send(reply, 404, {
          error: "Not Found",
          message: err instanceof Error ? err.message : "Task not found.",
        });
      }

      // ----- LLM call
      try {
        mcp.recordMetric("doApiCalls");
        const explainer = new AIExplainer(mcp.getConfig());
        const result = await explainer.generateExplanation(ctx);

        const response: ExplanationResponse = {
          taskId: body.taskId,
          explanation: result.explanation,
          relatedTaskIds: ctx.relatedTasks.map((t) => t.id),
          cached: false,
          generatedAt: new Date().toISOString(),
          model: result.model,
          tokensUsed: result.tokensUsed,
        };
        if (mcp.getConfig().cacheEnabled) {
          mcp.getCache().set(cacheKey, response);
        }
        mcp.recordMetric("explanationSuccess");
        mcp.getDailyUsage().successCount++;
        mcp.recordDuration(Date.now() - startedAt);
        return reply.code(200).send(response);
      } catch (err) {
        mcp.recordMetric("explanationError");
        mcp.getDailyUsage().errorCount++;
        if (err instanceof DOApiError) {
          const m = mapDOError(err, "explanation");
          return send(reply, m.status, m.body);
        }
        return send(reply, 500, {
          error: "Internal Server Error",
          message: `Failed to generate explanation: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    },
  );

  // --------------------------------------------------------------- /diagram
  app.post<{ Body: DiagramRequest }>(
    "/api/mcp/diagram",
    async (req, reply) => {
      const startedAt = Date.now();
      const route = "/api/mcp/diagram";
      const body = (req.body ?? {}) as Partial<DiagramRequest>;

      if (!body.taskId || typeof body.taskId !== "string") {
        return send(reply, 400, {
          error: "Bad Request",
          message: "taskId is required and must be a string.",
        });
      }
      if (!body.roomId || typeof body.roomId !== "string") {
        return send(reply, 400, {
          error: "Bad Request",
          message: "roomId is required and must be a string.",
        });
      }

      const forced = body.diagramType as DiagramType | undefined;
      if (forced && !["flowchart", "graph", "timeline"].includes(forced)) {
        return send(reply, 400, {
          error: "Bad Request",
          message: "diagramType must be flowchart, graph, or timeline.",
        });
      }

      const auth = await authorizeLeadInRoom(req, body.roomId, route);
      if (!auth.ok) {
        return send(reply, auth.status, {
          error: auth.status === 401 ? "Unauthorized" : "Forbidden",
          message: auth.message,
          reason: auth.reason,
        });
      }

      if (!mcp.isConfigured()) {
        return configError(reply);
      }

      mcp.recordMetric("diagramRequests");
      mcp.getDailyUsage().diagramRequests++;

      const limit = mcp.getRateLimiter().recordRequest(auth.claims.sub);
      if (!limit.allowed) {
        mcp.recordMetric("rateLimitViolations");
        mcp.getDailyUsage().rateLimitViolations++;
        reply.header("retry-after", String(limit.retryAfterSec));
        return send(reply, 429, {
          error: "Too Many Requests",
          message: `Too many diagram requests. Try again in ${limit.retryAfterSec}s.`,
          retryAfter: limit.retryAfterSec,
        });
      }

      const cacheKey = diagramCacheKey(body.roomId, body.taskId, forced ?? "auto");
      if (mcp.getConfig().cacheEnabled) {
        const cached = mcp.getCache().get(cacheKey) as DiagramResponse | undefined;
        if (cached && "mermaid" in cached) {
          mcp.recordMetric("cacheHits");
          mcp.getDailyUsage().cacheHits++;
          return reply.code(200).send(cached);
        }
        mcp.recordMetric("cacheMisses");
      }

      let ctx;
      try {
        ctx = await extractTaskContext(body.taskId, body.roomId, {
          proximityRadius: mcp.getConfig().proximityRadius,
          maxRelated: mcp.getConfig().maxRelatedTasks,
        });
      } catch (err) {
        mcp.recordMetric("diagramError");
        mcp.getDailyUsage().errorCount++;
        return send(reply, 404, {
          error: "Not Found",
          message: err instanceof Error ? err.message : "Task not found.",
        });
      }

      try {
        mcp.recordMetric("doApiCalls");
        const generator = new DiagramGenerator(mcp.getConfig());
        const result = await generator.generate(ctx, forced);
        const response: DiagramResponse = {
          taskId: body.taskId,
          diagramType: result.diagramType,
          mermaid: result.mermaid,
          nodeCount: result.nodeCount,
          generatedAt: new Date().toISOString(),
          model: result.model,
        };
        if (mcp.getConfig().cacheEnabled) {
          mcp.getCache().set(cacheKey, response);
        }
        mcp.recordMetric("diagramSuccess");
        mcp.getDailyUsage().successCount++;
        mcp.recordDuration(Date.now() - startedAt);
        return reply.code(200).send(response);
      } catch (err) {
        mcp.recordMetric("diagramError");
        mcp.getDailyUsage().errorCount++;
        if (err instanceof DOApiError) {
          const m = mapDOError(err, "diagram");
          return send(reply, m.status, m.body);
        }
        return send(reply, 500, {
          error: "Internal Server Error",
          message: `Failed to generate diagram: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    },
  );

  // ----------------------------- cache invalidation hook (used internally)
  app.post<{ Body: { roomId: string; taskId?: string } }>(
    "/api/mcp/cache/invalidate",
    async (req, reply) => {
      const auth = await authorizeLeadInRoom(req, req.body?.roomId ?? "", "/api/mcp/cache/invalidate");
      if (!auth.ok) {
        return send(reply, auth.status, {
          error: auth.status === 401 ? "Unauthorized" : "Forbidden",
          message: auth.message,
          reason: auth.reason,
        });
      }
      const { roomId, taskId } = req.body;
      const removed = taskId
        ? mcp.getCache().invalidateContaining(`:${roomId}:${taskId}`)
        : mcp.getCache().invalidateContaining(`:${roomId}:`);
      return reply.send({ ok: true, removed });
    },
  );
}
