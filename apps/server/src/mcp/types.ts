/**
 * Shared types for the MCP (AI Explainer) subsystem.
 */

export type Role = "Lead" | "Contributor" | "Viewer";

export interface MCPConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
  rateLimitPerMinute: number;
  maxRelatedTasks: number;
  proximityRadius: number;
  configured: boolean;
}

export interface TaskInfo {
  id: string;
  text: string;
  intent: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
  position: { x: number; y: number };
}

export interface TaskContext {
  task: TaskInfo;
  relatedTasks: TaskInfo[];
  roomParticipants: Array<{ name: string; role: string }>;
  roomName: string;
}

export interface ExplanationRequest {
  taskId: string;
  roomId: string;
  includeRelatedTasks?: boolean;
}

export interface ExplanationResponse {
  taskId: string;
  explanation: string;
  relatedTaskIds: string[];
  cached: boolean;
  generatedAt: string;
  model?: string;
  tokensUsed?: number;
}

export type DiagramType = "flowchart" | "graph" | "timeline";

export interface DiagramRequest {
  taskId: string;
  roomId: string;
  diagramType?: DiagramType;
}

export interface DiagramResponse {
  taskId: string;
  diagramType: DiagramType;
  mermaid: string;
  nodeCount: number;
  generatedAt: string;
  model?: string;
}

export interface DOAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}

export interface UsageStats {
  date: string;
  explanationRequests: number;
  diagramRequests: number;
  successCount: number;
  errorCount: number;
  rateLimitViolations: number;
  cacheHits: number;
}
