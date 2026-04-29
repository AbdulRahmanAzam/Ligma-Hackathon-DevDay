# Implementation Plan: MCP Board AI Explainer

## Overview

This implementation plan breaks down the MCP Board AI Explainer feature into discrete, incremental coding tasks. The feature adds AI-powered task explanation and diagram generation capabilities to the Board system, restricted to Lead users only. Implementation will leverage the existing DigitalOcean GenAI API infrastructure (similar to `ai-summary.ts`) and integrate with the current RBAC system.

**Implementation Language**: TypeScript

**Key Integration Points**:
- Existing Fastify server (`apps/server/src/index.ts`)
- RBAC system (`packages/shared/src/rbac.ts`)
- DigitalOcean API client pattern (from `apps/server/src/api/ai-summary.ts`)
- Board UI context menus (`apps/web/src/App.tsx`)

## Tasks

- [~] 1. Set up MCP server infrastructure and configuration
  - Create directory structure: `apps/server/src/mcp/`
  - Define TypeScript interfaces for MCP requests/responses
  - Create configuration loader that reads DO_AI_* environment variables
  - Implement health check endpoint `/api/mcp/health`
  - Add MCP server initialization to main server startup
  - _Requirements: 1.1, 1.6, 1.7, 10.1, 10.2, 10.3, 10.4, 10.6, 10.7_

- [ ] 2. Implement core MCP server module
  - [~] 2.1 Create MCP server class with initialization and shutdown methods
    - Write `apps/server/src/mcp/server.ts` with MCPServer class
    - Implement `initialize()` method that validates configuration
    - Implement `shutdown()` method for graceful cleanup
    - Add logging for startup configuration (excluding sensitive credentials)
    - _Requirements: 1.1, 1.6, 10.6, 10.7_

  - [~] 2.2 Write unit tests for MCP server initialization
    - Test successful initialization with valid config
    - Test graceful handling of missing configuration
    - Test configuration validation logic
    - _Requirements: 1.7, 10.7_

- [ ] 3. Implement response cache module
  - [~] 3.1 Create in-memory cache with TTL support
    - Write `apps/server/src/mcp/cache.ts` with ResponseCache class
    - Implement `get()`, `set()`, and `cleanup()` methods
    - Add TTL-based expiration logic
    - Implement cache statistics tracking (hits, misses, size)
    - _Requirements: 9.5_

  - [~] 3.2 Write unit tests for cache operations
    - Test cache hit/miss scenarios
    - Test TTL expiration
    - Test cache statistics calculation
    - _Requirements: 9.5_

- [ ] 4. Implement rate limiter module
  - [~] 4.1 Create token bucket rate limiter
    - Write `apps/server/src/mcp/rate-limiter.ts` with RateLimiter class
    - Implement per-user request tracking with 10 requests per minute limit
    - Implement `checkLimit()` and `recordRequest()` methods
    - Add automatic counter reset after time window
    - _Requirements: 9.3, 9.4, 11.5_

  - [~] 4.2 Write unit tests for rate limiting
    - Test rate limit enforcement
    - Test counter reset after time window
    - Test multiple users tracked independently
    - _Requirements: 9.3, 9.4_

- [~] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement task context extraction
  - [~] 6.1 Create context extractor module
    - Write `apps/server/src/mcp/context-extractor.ts`
    - Implement `extractTaskContext()` to get task text, intent, author, timestamp
    - Implement `findRelatedTasks()` using proximity radius calculation
    - Extract room context including participant names and roles
    - Query database for task and room data
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [~] 6.2 Write unit tests for context extraction
    - Test task metadata extraction
    - Test proximity-based related task finding
    - Test room context extraction
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 7. Implement AI explainer module
  - [~] 7.1 Create AI explainer with DigitalOcean API integration
    - Write `apps/server/src/mcp/explainer.ts` with AIExplainer class
    - Implement `buildExplanationPrompt()` to create structured prompts
    - Implement `generateExplanation()` to call DigitalOcean API
    - Set temperature to 0.4 and max_tokens to 2000
    - Parse and validate API responses
    - Handle API errors with retry logic (exponential backoff)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [~] 7.2 Write unit tests for AI explainer
    - Test prompt building with various task contexts
    - Test API response parsing
    - Test error handling and retry logic
    - Mock DigitalOcean API responses
    - _Requirements: 4.1, 4.2, 4.3, 4.9_

- [ ] 8. Implement diagram generator module
  - [~] 8.1 Create diagram generator with Mermaid syntax generation
    - Write `apps/server/src/mcp/diagram.ts` with DiagramGenerator class
    - Implement `analyzeDiagramType()` to determine flowchart/graph/timeline
    - Implement `generateMermaidDiagram()` to create Mermaid syntax
    - Implement `validateDiagram()` to check Mermaid syntax validity
    - Limit diagrams to maximum 20 nodes
    - Use DigitalOcean API to generate diagram structure
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [~] 8.2 Write unit tests for diagram generator
    - Test diagram type analysis
    - Test Mermaid syntax generation
    - Test diagram validation
    - Test node limit enforcement
    - _Requirements: 5.2, 5.3, 5.4, 5.7_

- [~] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implement RBAC authorization for AI features
  - [~] 10.1 Create authorization middleware for MCP endpoints
    - Write `apps/server/src/mcp/auth.ts` with authorization functions
    - Implement multi-layer authorization (JWT → room role → Lead check)
    - Return 403 Forbidden for non-Lead users
    - Log all authorization failures for audit
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [~] 10.2 Write unit tests for authorization
    - Test Lead user authorization success
    - Test Contributor/Viewer rejection
    - Test invalid token handling
    - Test audit logging
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 11. Implement HTTP API endpoints for explanations
  - [~] 11.1 Create POST /api/mcp/explain endpoint
    - Add route handler in `apps/server/src/api/mcp-routes.ts`
    - Validate request body (taskId, roomId)
    - Call authorization middleware
    - Check rate limits
    - Check cache for existing explanation
    - Extract task context
    - Generate explanation using AIExplainer
    - Store response in cache
    - Return ExplanationResponse
    - _Requirements: 4.1, 4.2, 4.5, 4.6, 9.1, 9.2, 9.3, 9.5_

  - [~] 11.2 Add error handling for explanation endpoint
    - Handle configuration errors (503 Service Unavailable)
    - Handle authentication errors (401/403)
    - Handle API errors (502 Bad Gateway)
    - Handle rate limit errors (429 Too Many Requests)
    - Handle validation errors (400 Bad Request)
    - Log all errors with sufficient detail
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [~] 11.3 Write integration tests for explanation endpoint
    - Test successful explanation generation
    - Test cache hit scenario
    - Test rate limiting enforcement
    - Test authorization rejection
    - Test error scenarios
    - _Requirements: 4.1, 4.5, 9.3, 9.5_

- [ ] 12. Implement HTTP API endpoints for diagrams
  - [~] 12.1 Create POST /api/mcp/diagram endpoint
    - Add route handler in `apps/server/src/api/mcp-routes.ts`
    - Validate request body (taskId, roomId, optional diagramType)
    - Call authorization middleware
    - Check rate limits
    - Extract task context and related tasks
    - Generate diagram using DiagramGenerator
    - Return DiagramResponse with Mermaid syntax
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 9.1, 9.3_

  - [~] 12.2 Add error handling for diagram endpoint
    - Handle all error categories (config, auth, API, rate limit, validation)
    - Use same error handling patterns as explanation endpoint
    - Log errors for debugging
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [~] 12.3 Write integration tests for diagram endpoint
    - Test successful diagram generation
    - Test different diagram types
    - Test node limit enforcement
    - Test authorization rejection
    - _Requirements: 5.1, 5.2, 5.7_

- [~] 13. Register MCP routes with Fastify server
  - Import and register MCP routes in `apps/server/src/index.ts`
  - Initialize MCP server on startup
  - Add health check endpoint registration
  - Handle graceful shutdown
  - _Requirements: 1.1, 10.4, 10.5_

- [~] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Implement Board UI context menu integration
  - [ ] 15.1 Add "Explain with AI" context menu action
    - Modify `apps/web/src/App.tsx` to add context menu items
    - Show "Explain with AI" option when Lead user right-clicks task node
    - Hide option for non-Lead users
    - Add tooltip explaining Lead-only access
    - _Requirements: 7.1, 7.2, 7.5, 7.6_

  - [ ] 15.2 Add "Generate Diagram" context menu action
    - Add "Generate Diagram" option in context menu
    - Show only for Lead users
    - Position below "Explain with AI" option
    - _Requirements: 7.4, 7.5, 7.6_

  - [ ] 15.3 Write UI tests for context menu
    - Test menu visibility for different roles
    - Test menu item click handlers
    - Test tooltip display
    - _Requirements: 7.1, 7.4, 7.5, 7.6_

- [ ] 16. Implement explanation request handling in UI
  - [ ] 16.1 Create MCP integration module
    - Write `apps/web/src/mcp-integration.ts` with MCPIntegration class
    - Implement `requestExplanation()` to call POST /api/mcp/explain
    - Add loading state management
    - Add error notification display
    - Implement 15-second timeout
    - _Requirements: 4.1, 7.2, 7.3, 8.4, 9.1_

  - [ ] 16.2 Create explanation node rendering
    - Implement `createExplanationNode()` to add explanation to canvas
    - Position explanation node adjacent to source task
    - Style with light blue gradient background (#e1f5ff to #f0f9ff)
    - Add dashed border with AI sparkle icon
    - Add header "AI Explanation" with timestamp
    - Add footer "Generated by AI • [Model Name]"
    - Add visual connector line to source task
    - Support collapse/expand functionality
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [ ] 16.3 Write UI tests for explanation rendering
    - Test explanation node creation
    - Test positioning logic
    - Test styling and visual elements
    - Test collapse/expand functionality
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [ ] 17. Implement diagram request handling in UI
  - [ ] 17.1 Create diagram request handler
    - Implement `requestDiagram()` to call POST /api/mcp/diagram
    - Add loading state management
    - Add error notification display
    - Implement 20-second timeout (longer for complex diagrams)
    - _Requirements: 5.1, 7.4, 8.4, 9.1_

  - [ ] 17.2 Create diagram node rendering with Mermaid
    - Implement `createDiagramNode()` to add diagram to canvas
    - Integrate Mermaid library for diagram rendering
    - Style with white background and subtle shadow
    - Add header "Diagram: [Type]" with timestamp
    - Add zoom in/out and fullscreen controls
    - Position diagram node near source task
    - _Requirements: 5.6, 6.1, 6.2, 6.3, 6.4_

  - [ ] 17.3 Write UI tests for diagram rendering
    - Test diagram node creation
    - Test Mermaid rendering
    - Test zoom and fullscreen controls
    - _Requirements: 5.6, 6.1, 6.2, 6.3_

- [ ] 18. Implement loading states and error notifications
  - [ ] 18.1 Add loading indicators
    - Show spinner overlay on source task during request
    - Display "Generating explanation..." tooltip
    - Display "Generating diagram..." tooltip
    - Disable additional requests for same task while loading
    - _Requirements: 7.3_

  - [ ] 18.2 Add error notification toasts
    - Implement non-intrusive toast notifications
    - Add specific messages for each error type:
      - "AI service temporarily unavailable. Please try again later." (API unavailable)
      - "Too many requests. Please wait a moment and try again." (rate limited)
      - "This task needs more details for AI explanation." (insufficient context)
      - "AI features are not configured. Contact your administrator." (config missing)
    - Auto-dismiss after 5 seconds
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6_

  - [ ] 18.3 Write UI tests for loading and error states
    - Test loading indicator display
    - Test error notification display
    - Test auto-dismiss behavior
    - _Requirements: 7.3, 8.1, 8.2, 8.3, 8.4_

- [ ] 19. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 20. Implement audit logging and monitoring
  - [ ] 20.1 Add request logging
    - Log explanation requests with user ID, task ID, timestamp
    - Log diagram requests with same metadata
    - Log response times for DigitalOcean API calls
    - Log token counts for each explanation
    - Log rate limit violations with user ID and timestamp
    - _Requirements: 11.1, 11.2, 11.3, 11.5_

  - [ ] 20.2 Add metrics collection
    - Implement Prometheus-compatible metrics:
      - `mcp_explanation_requests_total` (counter)
      - `mcp_explanation_requests_success` (counter)
      - `mcp_explanation_requests_error` (counter)
      - `mcp_explanation_duration_seconds` (histogram)
      - `mcp_cache_hits_total` (counter)
      - `mcp_cache_misses_total` (counter)
      - `mcp_rate_limit_violations_total` (counter)
      - `mcp_do_api_calls_total` (counter)
    - Expose metrics endpoint `/api/mcp/metrics`
    - _Requirements: 11.4_

  - [ ] 20.3 Add usage statistics endpoint
    - Create GET /api/mcp/stats endpoint
    - Return daily usage statistics
    - Include request counts, success rates, error rates
    - _Requirements: 11.6_

  - [ ] 20.4 Write tests for logging and metrics
    - Test log message format
    - Test metrics collection
    - Test statistics endpoint
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6_

- [ ] 21. Add environment variable documentation
  - Update `.env.example` with MCP configuration variables
  - Document DO_AI_ENDPOINT, DO_AI_API_KEY, DO_AI_MODEL
  - Document optional MCP_* configuration variables
  - Add comments explaining each variable
  - _Requirements: 10.1, 10.2, 10.3_

- [ ] 22. Implement cache invalidation logic
  - [ ] 22.1 Add cache invalidation on task edits
    - Hook into task update events
    - Invalidate cache entries for edited tasks
    - Invalidate cache entries for related tasks
    - _Requirements: 9.5_

  - [ ] 22.2 Add cache invalidation on task deletion
    - Hook into task deletion events
    - Remove cache entries for deleted tasks
    - _Requirements: 9.5_

  - [ ] 22.3 Write tests for cache invalidation
    - Test invalidation on task edit
    - Test invalidation on task deletion
    - Test related task invalidation
    - _Requirements: 9.5_

- [ ] 23. Add connection pooling for DigitalOcean API
  - Implement connection pool in `apps/server/src/mcp/do-api-client.ts`
  - Configure max 10 connections with keep-alive
  - Set 10-second timeout for requests
  - Implement connection acquisition and release
  - _Requirements: 9.6_

- [ ] 24. Final integration and wiring
  - [ ] 24.1 Wire all MCP components together
    - Ensure MCP server uses cache, rate limiter, and auth modules
    - Ensure API routes use MCP server methods
    - Ensure UI integration calls API endpoints correctly
    - Verify explanation and diagram nodes persist across sessions
    - _Requirements: 1.1, 6.7, 9.1, 9.2_

  - [ ] 24.2 Add feature flag for AI features
    - Check configuration on server startup
    - Disable AI features in UI if not configured
    - Hide context menu options when disabled
    - Return 503 for API requests when disabled
    - _Requirements: 1.7, 8.6, 10.7_

  - [ ] 24.3 Write end-to-end integration tests
    - Test complete explanation flow (UI → API → AI → UI)
    - Test complete diagram flow
    - Test authorization enforcement
    - Test rate limiting across requests
    - Test cache behavior
    - _Requirements: 4.1, 5.1, 9.3, 9.5_

- [ ] 25. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Implementation uses TypeScript throughout
- Leverages existing patterns from `ai-summary.ts` for DigitalOcean API integration
- Integrates with existing RBAC system without modifications
- All AI features gracefully degrade when configuration is missing
- Rate limiting and caching ensure performance and cost control
- Comprehensive error handling provides clear user feedback
- Audit logging enables monitoring and debugging

## Implementation Strategy

1. **Backend First**: Build MCP server infrastructure, API endpoints, and core logic (Tasks 1-14)
2. **Frontend Integration**: Add UI components and context menu integration (Tasks 15-19)
3. **Observability**: Add logging, metrics, and monitoring (Task 20)
4. **Polish**: Add cache invalidation, connection pooling, and final integration (Tasks 21-25)

## Dependencies

- **External Libraries**:
  - `mermaid` (for diagram rendering in UI)
  - Existing dependencies: `fastify`, `jose`, `better-sqlite3`, `tldraw`

- **Environment Variables**:
  - `DO_AI_ENDPOINT` (required)
  - `DO_AI_API_KEY` (required)
  - `DO_AI_MODEL` (required)
  - `MCP_CACHE_ENABLED` (optional, default: true)
  - `MCP_CACHE_TTL_SECONDS` (optional, default: 300)
  - `MCP_RATE_LIMIT_PER_MINUTE` (optional, default: 10)
  - `MCP_MAX_RELATED_TASKS` (optional, default: 10)
  - `MCP_PROXIMITY_RADIUS` (optional, default: 500)
