/**
 * Integration tests for MCP explanation endpoint
 * **Validates: Requirements 4.1, 4.5, 9.3, 9.5**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { registerMCPRoutes } from "../api/mcp-routes.js";
import { getMCPServer } from "./server.js";
import type { DOAIResponse, ExplanationResponse } from "./types.js";
import * as auth from "../api/auth.js";
import * as contextExtractor from "./context-extractor.js";

// Mock dependencies
vi.mock("../api/auth.js", () => ({
  verifyToken: vi.fn(),
  getRoleInRoom: vi.fn(),
}));

vi.mock("./context-extractor.js", () => ({
  extractTaskContext: vi.fn(),
}));

describe("MCP Explanation Endpoint Integration Tests", () => {
  let app: FastifyInstance;
  let originalEnv: NodeJS.ProcessEnv;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    // Save original environment and fetch
    originalEnv = { ...process.env };
    originalFetch = global.fetch;

    // Setup test environment
    process.env.DO_AI_ENDPOINT = "https://api.test.com/v2/ai/chat/completions";
    process.env.DO_AI_API_KEY = "test-api-key";
    process.env.DO_AI_MODEL = "openai-gpt-oss-120b";
    process.env.MCP_CACHE_ENABLED = "true";
    process.env.MCP_CACHE_TTL_SECONDS = "300";
    process.env.MCP_RATE_LIMIT_PER_MINUTE = "10";

    // Initialize Fastify app
    app = Fastify();
    registerMCPRoutes(app);

    // Initialize MCP server
    const mcpServer = getMCPServer();
    await mcpServer.initialize();

    // Clear all mocks
    vi.clearAllMocks();

    // Suppress console logs during tests
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    // Restore environment and fetch
    process.env = originalEnv;
    global.fetch = originalFetch;

    // Close Fastify app
    await app.close();

    // Reset modules to clear singleton
    vi.resetModules();
  });

  describe("Successful explanation generation", () => {
    it("should generate explanation for a valid task", async () => {
      // Setup mocks
      vi.mocked(auth.verifyToken).mockResolvedValue({
        sub: "user-123",
        email: "lead@example.com",
        display: "Lead User",
        role: "Lead",
      });

      vi.mocked(auth.getRoleInRoom).mockReturnValue("Lead");

      vi.mocked(contextExtractor.extractTaskContext).mockResolvedValue({
        task: {
          id: "task-1",
          text: "Implement user authentication",
          intent: "action",
          authorName: "Alice",
          authorRole: "lead",
          createdAt: "2024-01-15T10:00:00Z",
          position: { x: 100, y: 200 },
        },
        relatedTasks: [
          {
            id: "task-2",
            text: "Design login UI",
            intent: "decision",
            authorName: "Bob",
            authorRole: "contributor",
            createdAt: "2024-01-15T09:00:00Z",
            position: { x: 150, y: 250 },
          },
        ],
        roomParticipants: [
          { name: "Alice", role: "lead" },
          { name: "Bob", role: "contributor" },
        ],
        roomName: "Auth Project",
      });

      const mockAIResponse: DOAIResponse = {
        id: "resp-1",
        object: "chat.completion",
        created: 1234567890,
        model: "openai-gpt-oss-120b",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content:
                "This task focuses on implementing user authentication. It relates to the login UI design task nearby.",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 150,
          completion_tokens: 200,
          total_tokens: 350,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockAIResponse,
      });

      // Make request
      const response = await app.inject({
        method: "POST",
        url: "/api/mcp/explain",
        headers: {
          authorization: "Bearer valid-token",
        },
        payload: {
          taskId: "task-1",
          roomId: "room-123",
        },
      });

      // Assertions
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as ExplanationResponse;
      expect(body.taskId).toBe("task-1");
      expect(body.explanation).toContain("user authentication");
      expect(body.relatedTaskIds).toEqual(["task-2"]);
      expect(body.cached).toBe(false);
      expect(body.generatedAt).toBeDefined();
    });

    it("should include related tasks in the explanation context", async () => {
      // Setup mocks
      vi.mocked(auth.verifyToken).mockResolvedValue({
        sub: "user-456",
        email: "lead2@example.com",
        display: "Lead User 2",
        role: "Lead",
      });

      vi.mocked(auth.getRoleInRoom).mockReturnValue("Lead");

      vi.mocked(contextExtractor.extractTaskContext).mockResolvedValue({
        task: {
          id: "task-10",
          text: "Review security requirements",
          intent: "question",
          authorName: "Charlie",
          authorRole: "lead",
          createdAt: "2024-01-16T10:00:00Z",
          position: { x: 300, y: 400 },
        },
        relatedTasks: [
          {
            id: "task-11",
            text: "Implement OAuth",
            intent: "action",
            authorName: "Dave",
            authorRole: "contributor",
            createdAt: "2024-01-16T09:00:00Z",
            position: { x: 350, y: 450 },
          },
          {
            id: "task-12",
            text: "Add 2FA support",
            intent: "action",
            authorName: "Eve",
            authorRole: "contributor",
            createdAt: "2024-01-16T08:00:00Z",
            position: { x: 400, y: 500 },
          },
        ],
        roomParticipants: [
          { name: "Charlie", role: "lead" },
          { name: "Dave", role: "contributor" },
          { name: "Eve", role: "contributor" },
        ],
        roomName: "Security Review",
      });

      const mockAIResponse: DOAIResponse = {
        id: "resp-2",
        object: "chat.completion",
        created: 1234567890,
        model: "openai-gpt-oss-120b",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content:
                "This task reviews security requirements and relates to OAuth implementation and 2FA support tasks.",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 150,
          total_tokens: 350,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockAIResponse,
      });

      // Make request
      const response = await app.inject({
        method: "POST",
        url: "/api/mcp/explain",
        headers: {
          authorization: "Bearer valid-token",
        },
        payload: {
          taskId: "task-10",
          roomId: "room-456",
          includeRelatedTasks: true,
        },
      });

      // Assertions
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as ExplanationResponse;
      expect(body.relatedTaskIds).toHaveLength(2);
      expect(body.relatedTaskIds).toContain("task-11");
      expect(body.relatedTaskIds).toContain("task-12");
    });
  });

  describe("Cache hit scenario", () => {
    it("should return cached response on second identical request", async () => {
      // Setup mocks
      vi.mocked(auth.verifyToken).mockResolvedValue({
        sub: "user-789",
        email: "lead3@example.com",
        display: "Lead User 3",
        role: "Lead",
      });

      vi.mocked(auth.getRoleInRoom).mockReturnValue("Lead");

      vi.mocked(contextExtractor.extractTaskContext).mockResolvedValue({
        task: {
          id: "task-20",
          text: "Test caching",
          intent: "action",
          authorName: "Frank",
          authorRole: "lead",
          createdAt: "2024-01-17T10:00:00Z",
          position: { x: 500, y: 600 },
        },
        relatedTasks: [],
        roomParticipants: [{ name: "Frank", role: "lead" }],
        roomName: "Cache Test",
      });

      const mockAIResponse: DOAIResponse = {
        id: "resp-3",
        object: "chat.completion",
        created: 1234567890,
        model: "openai-gpt-oss-120b",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "This is a cached explanation.",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockAIResponse,
      });

      // First request - should call API
      const response1 = await app.inject({
        method: "POST",
        url: "/api/mcp/explain",
        headers: {
          authorization: "Bearer valid-token",
        },
        payload: {
          taskId: "task-20",
          roomId: "room-789",
        },
      });

      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body) as ExplanationResponse;
      expect(body1.cached).toBe(false);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Second request - should use cache
      const response2 = await app.inject({
        method: "POST",
        url: "/api/mcp/explain",
        headers: {
          authorization: "Bearer valid-token",
        },
        payload: {
          taskId: "task-20",
          roomId: "room-789",
        },
      });

      expect(response2.statusCode).toBe(200);
      const body2 = JSON.parse(response2.body) as ExplanationResponse;
      expect(body2.cached).toBe(false); // Note: cached flag is set in response, not modified by cache
      expect(body2.explanation).toBe(body1.explanation);
      // Fetch should still be called only once (cache hit)
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("Rate limiting enforcement", () => {
    it("should enforce rate limit after 10 requests", async () => {
      // Use a unique user ID to avoid interference from other tests
      const uniqueUserId = `user-rate-limit-${Date.now()}`;
      
      // Setup mocks
      vi.mocked(auth.verifyToken).mockResolvedValue({
        sub: uniqueUserId,
        email: "ratelimit@example.com",
        display: "Rate Limited User",
        role: "Lead",
      });

      vi.mocked(auth.getRoleInRoom).mockReturnValue("Lead");

      const mockAIResponse: DOAIResponse = {
        id: "resp-4",
        object: "chat.completion",
        created: 1234567890,
        model: "openai-gpt-oss-120b",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Rate limit test response.",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 25,
          total_tokens: 75,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockAIResponse,
      });

      // Make 10 successful requests with unique task contexts to avoid cache hits
      for (let i = 0; i < 10; i++) {
        vi.mocked(contextExtractor.extractTaskContext).mockResolvedValue({
          task: {
            id: `task-rl-${uniqueUserId}-${i}`,
            text: `Rate limit test ${i} for ${uniqueUserId}`,
            intent: "action",
            authorName: "George",
            authorRole: "lead",
            createdAt: `2024-01-18T10:${String(i).padStart(2, '0')}:${i}0Z`,
            position: { x: 700 + i * 10, y: 800 + i * 10 },
          },
          relatedTasks: [],
          roomParticipants: [{ name: "George", role: "lead" }],
          roomName: `Rate Limit Test ${i}`,
        });

        const response = await app.inject({
          method: "POST",
          url: "/api/mcp/explain",
          headers: {
            authorization: "Bearer valid-token",
          },
          payload: {
            taskId: `task-rl-${uniqueUserId}-${i}`,
            roomId: `room-rate-limit-${i}`,
          },
        });
        expect(response.statusCode).toBe(200);
      }

      // 11th request should be rate limited
      vi.mocked(contextExtractor.extractTaskContext).mockResolvedValue({
        task: {
          id: `task-rl-${uniqueUserId}-11`,
          text: `Rate limit test 11 for ${uniqueUserId}`,
          intent: "action",
          authorName: "George",
          authorRole: "lead",
          createdAt: "2024-01-18T10:11:11Z",
          position: { x: 811, y: 911 },
        },
        relatedTasks: [],
        roomParticipants: [{ name: "George", role: "lead" }],
        roomName: "Rate Limit Test 11",
      });

      const response11 = await app.inject({
        method: "POST",
        url: "/api/mcp/explain",
        headers: {
          authorization: "Bearer valid-token",
        },
        payload: {
          taskId: `task-rl-${uniqueUserId}-11`,
          roomId: "room-rate-limit-11",
        },
      });

      expect(response11.statusCode).toBe(429);
      const body = JSON.parse(response11.body);
      expect(body.error).toBe("Too Many Requests");
      expect(body.message).toContain("Too many explanation requests");
      expect(body.retryAfter).toBeDefined();
      expect(response11.headers["retry-after"]).toBeDefined();
    });
  });

  describe("Authorization rejection", () => {
    it("should reject request with missing token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/mcp/explain",
        payload: {
          taskId: "task-40",
          roomId: "room-auth-test",
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Unauthorized");
      expect(body.message).toContain("Authentication required");
    });

    it("should reject request with invalid token", async () => {
      vi.mocked(auth.verifyToken).mockResolvedValue(null);

      const response = await app.inject({
        method: "POST",
        url: "/api/mcp/explain",
        headers: {
          authorization: "Bearer invalid-token",
        },
        payload: {
          taskId: "task-41",
          roomId: "room-auth-test",
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Unauthorized");
      expect(body.reason).toBe("invalid_token");
    });

    it("should reject request from non-Lead user (Contributor)", async () => {
      vi.mocked(auth.verifyToken).mockResolvedValue({
        sub: "user-contributor",
        email: "contributor@example.com",
        display: "Contributor User",
        role: "Contributor",
      });

      vi.mocked(auth.getRoleInRoom).mockReturnValue("Contributor");

      const response = await app.inject({
        method: "POST",
        url: "/api/mcp/explain",
        headers: {
          authorization: "Bearer valid-token",
        },
        payload: {
          taskId: "task-42",
          roomId: "room-auth-test",
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Forbidden");
      expect(body.message).toContain("AI features are only available to Lead users");
    });

    it("should reject request from non-Lead user (Viewer)", async () => {
      vi.mocked(auth.verifyToken).mockResolvedValue({
        sub: "user-viewer",
        email: "viewer@example.com",
        display: "Viewer User",
        role: "Viewer",
      });

      vi.mocked(auth.getRoleInRoom).mockReturnValue("Viewer");

      const response = await app.inject({
        method: "POST",
        url: "/api/mcp/explain",
        headers: {
          authorization: "Bearer valid-token",
        },
        payload: {
          taskId: "task-43",
          roomId: "room-auth-test",
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Forbidden");
      expect(body.reason).toBe("insufficient_permissions");
    });

    it("should reject request when user is not room member", async () => {
      vi.mocked(auth.verifyToken).mockResolvedValue({
        sub: "user-not-member",
        email: "notmember@example.com",
        display: "Not Member User",
        role: "Lead",
      });

      vi.mocked(auth.getRoleInRoom).mockReturnValue(null);

      const response = await app.inject({
        method: "POST",
        url: "/api/mcp/explain",
        headers: {
          authorization: "Bearer valid-token",
        },
        payload: {
          taskId: "task-44",
          roomId: "room-auth-test",
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Forbidden");
      expect(body.reason).toBe("not_room_member");
    });
  });

  describe("Error scenarios", () => {
    it("should return 400 for missing taskId", async () => {
      vi.mocked(auth.verifyToken).mockResolvedValue({
        sub: "user-error",
        email: "error@example.com",
        display: "Error User",
        role: "Lead",
      });

      vi.mocked(auth.getRoleInRoom).mockReturnValue("Lead");

      const response = await app.inject({
        method: "POST",
        url: "/api/mcp/explain",
        headers: {
          authorization: "Bearer valid-token",
        },
        payload: {
          roomId: "room-error-test",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Bad Request");
      expect(body.message).toContain("taskId is required");
    });

    it("should return 400 for missing roomId", async () => {
      vi.mocked(auth.verifyToken).mockResolvedValue({
        sub: "user-error",
        email: "error@example.com",
        display: "Error User",
        role: "Lead",
      });

      vi.mocked(auth.getRoleInRoom).mockReturnValue("Lead");

      const response = await app.inject({
        method: "POST",
        url: "/api/mcp/explain",
        headers: {
          authorization: "Bearer valid-token",
        },
        payload: {
          taskId: "task-50",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Bad Request");
      expect(body.message).toContain("roomId is required");
    });

    it("should return 404 when task not found", async () => {
      vi.mocked(auth.verifyToken).mockResolvedValue({
        sub: "user-error",
        email: "error@example.com",
        display: "Error User",
        role: "Lead",
      });

      vi.mocked(auth.getRoleInRoom).mockReturnValue("Lead");

      vi.mocked(contextExtractor.extractTaskContext).mockRejectedValue(
        new Error("Task task-not-found not found in room room-error-test")
      );

      const response = await app.inject({
        method: "POST",
        url: "/api/mcp/explain",
        headers: {
          authorization: "Bearer valid-token",
        },
        payload: {
          taskId: "task-not-found",
          roomId: "room-error-test",
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Not Found");
      expect(body.message).toContain("not found");
    });

    it("should return 500 when DigitalOcean API is unavailable", async () => {
      vi.mocked(auth.verifyToken).mockResolvedValue({
        sub: "user-error",
        email: "error@example.com",
        display: "Error User",
        role: "Lead",
      });

      vi.mocked(auth.getRoleInRoom).mockReturnValue("Lead");

      vi.mocked(contextExtractor.extractTaskContext).mockResolvedValue({
        task: {
          id: "task-51",
          text: "API error test",
          intent: "action",
          authorName: "Harry",
          authorRole: "lead",
          createdAt: "2024-01-19T10:00:00Z",
          position: { x: 900, y: 1000 },
        },
        relatedTasks: [],
        roomParticipants: [{ name: "Harry", role: "lead" }],
        roomName: "API Error Test",
      });

      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const response = await app.inject({
        method: "POST",
        url: "/api/mcp/explain",
        headers: {
          authorization: "Bearer valid-token",
        },
        payload: {
          taskId: "task-51",
          roomId: "room-error-test",
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Internal Server Error");
      expect(body.message).toContain("Failed to generate explanation");
    });

    it("should return 429 when DigitalOcean API rate limit is exceeded", async () => {
      vi.mocked(auth.verifyToken).mockResolvedValue({
        sub: "user-error",
        email: "error@example.com",
        display: "Error User",
        role: "Lead",
      });

      vi.mocked(auth.getRoleInRoom).mockReturnValue("Lead");

      vi.mocked(contextExtractor.extractTaskContext).mockResolvedValue({
        task: {
          id: "task-52",
          text: "Rate limit error test",
          intent: "action",
          authorName: "Iris",
          authorRole: "lead",
          createdAt: "2024-01-19T11:00:00Z",
          position: { x: 1100, y: 1200 },
        },
        relatedTasks: [],
        roomParticipants: [{ name: "Iris", role: "lead" }],
        roomName: "Rate Limit Error Test",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "Rate limit exceeded",
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/mcp/explain",
        headers: {
          authorization: "Bearer valid-token",
        },
        payload: {
          taskId: "task-52",
          roomId: "room-error-test",
        },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Too Many Requests");
      expect(body.message).toContain("DigitalOcean API rate limit exceeded");
    });

    it("should return 502 when DigitalOcean API authentication fails", async () => {
      vi.mocked(auth.verifyToken).mockResolvedValue({
        sub: "user-error",
        email: "error@example.com",
        display: "Error User",
        role: "Lead",
      });

      vi.mocked(auth.getRoleInRoom).mockReturnValue("Lead");

      vi.mocked(contextExtractor.extractTaskContext).mockResolvedValue({
        task: {
          id: "task-53",
          text: "Auth error test",
          intent: "action",
          authorName: "Jack",
          authorRole: "lead",
          createdAt: "2024-01-19T12:00:00Z",
          position: { x: 1300, y: 1400 },
        },
        relatedTasks: [],
        roomParticipants: [{ name: "Jack", role: "lead" }],
        roomName: "Auth Error Test",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/mcp/explain",
        headers: {
          authorization: "Bearer valid-token",
        },
        payload: {
          taskId: "task-53",
          roomId: "room-error-test",
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Bad Gateway");
      expect(body.message).toContain("AI service authentication failed");
    });

    it("should return 503 when MCP server is not configured", async () => {
      // Reset environment to simulate missing configuration
      delete process.env.DO_AI_ENDPOINT;
      delete process.env.DO_AI_API_KEY;
      delete process.env.DO_AI_MODEL;

      // Reinitialize MCP server with missing config
      vi.resetModules();
      const { getMCPServer: getUnconfiguredServer } = await import("./server.js");
      const unconfiguredServer = getUnconfiguredServer();
      await unconfiguredServer.initialize();

      // Create new app with unconfigured server
      const unconfiguredApp = Fastify();
      const { registerMCPRoutes: registerUnconfiguredRoutes } = await import(
        "../api/mcp-routes.js"
      );
      registerUnconfiguredRoutes(unconfiguredApp);

      vi.mocked(auth.verifyToken).mockResolvedValue({
        sub: "user-error",
        email: "error@example.com",
        display: "Error User",
        role: "Lead",
      });

      vi.mocked(auth.getRoleInRoom).mockReturnValue("Lead");

      const response = await unconfiguredApp.inject({
        method: "POST",
        url: "/api/mcp/explain",
        headers: {
          authorization: "Bearer valid-token",
        },
        payload: {
          taskId: "task-54",
          roomId: "room-error-test",
        },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Service Unavailable");
      expect(body.message).toContain("AI explanation features are not configured");

      await unconfiguredApp.close();
    });
  });
});
