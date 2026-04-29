# Requirements Document

## Introduction

The MCP Board AI Explainer feature enables Lead users to request AI-generated explanations and diagrams for specific tasks on the collaborative board. This feature integrates an MCP (Model Context Protocol) server with the existing Board system, leveraging DigitalOcean's GenAI API to provide contextual task explanations and visual diagrams that help teams understand complex tasks more effectively.

## Glossary

- **MCP_Server**: The Model Context Protocol server that handles AI explanation requests and diagram generation
- **Board_System**: The existing collaborative workspace canvas where users create and manage tasks
- **Lead_User**: A user with the "lead" role who has permission to request AI explanations
- **Task_Node**: A node on the board representing a task, decision, action item, or reference
- **AI_Explainer**: The component that processes task context and generates explanations using the DigitalOcean GenAI API
- **Diagram_Generator**: The component that creates visual diagrams to explain task relationships and workflows
- **RBAC_System**: The Role-Based Access Control system that enforces permission rules
- **Explanation_Request**: A request from a Lead user to generate an AI explanation for a specific task
- **Explanation_Response**: The AI-generated explanation and optional diagram returned to the user
- **DigitalOcean_API**: The DigitalOcean GenAI API endpoint used for AI model inference
- **GPT_Model**: The OpenAI GPT model (openai-gpt-oss-120b) used for generating explanations

## Requirements

### Requirement 1: MCP Server Implementation

**User Story:** As a system architect, I want an MCP server that integrates with the Board system, so that AI explanation capabilities can be accessed through a standardized protocol.

#### Acceptance Criteria

1. THE MCP_Server SHALL implement the Model Context Protocol specification
2. THE MCP_Server SHALL expose tools for requesting task explanations and diagram generation
3. THE MCP_Server SHALL authenticate requests using the existing authentication system
4. THE MCP_Server SHALL connect to the DigitalOcean_API using the provided API key
5. THE MCP_Server SHALL use the GPT_Model (openai-gpt-oss-120b) for all AI inference operations
6. WHEN the MCP_Server starts, THE MCP_Server SHALL validate that the DigitalOcean_API credentials are configured
7. IF the DigitalOcean_API credentials are missing, THEN THE MCP_Server SHALL log an error and disable AI explanation features

### Requirement 2: Lead-Only Access Control

**User Story:** As a security administrator, I want AI explanation requests to be restricted to Lead users only, so that this premium feature is properly controlled.

#### Acceptance Criteria

1. WHEN an Explanation_Request is received, THE RBAC_System SHALL verify the requesting user has the "lead" role
2. IF the requesting user does not have the "lead" role, THEN THE MCP_Server SHALL reject the request with an authorization error
3. THE RBAC_System SHALL check role permissions before processing any Explanation_Request
4. THE MCP_Server SHALL return a 403 Forbidden status code for unauthorized explanation requests
5. THE MCP_Server SHALL log all authorization failures for audit purposes

### Requirement 3: Task Context Extraction

**User Story:** As a Lead user, I want the AI to understand the full context of a task, so that explanations are accurate and relevant.

#### Acceptance Criteria

1. WHEN an Explanation_Request is received for a Task_Node, THE AI_Explainer SHALL extract the task text content
2. THE AI_Explainer SHALL extract the task intent label (action item, decision, open question, or reference)
3. THE AI_Explainer SHALL extract the task author name and role
4. THE AI_Explainer SHALL extract the task creation timestamp
5. THE AI_Explainer SHALL extract related tasks within a configurable proximity radius on the Board_System
6. THE AI_Explainer SHALL extract the room context including participant names and roles
7. THE AI_Explainer SHALL compile all extracted context into a structured prompt for the GPT_Model

### Requirement 4: AI Explanation Generation

**User Story:** As a Lead user, I want to request an AI explanation for a specific task, so that I can better understand its purpose, implications, and relationships.

#### Acceptance Criteria

1. WHEN a Lead_User requests an explanation for a Task_Node, THE AI_Explainer SHALL send a request to the DigitalOcean_API
2. THE AI_Explainer SHALL include the task context and related tasks in the API request
3. THE AI_Explainer SHALL set the temperature parameter to 0.4 for consistent explanations
4. THE AI_Explainer SHALL set the max_tokens parameter to 2000 for explanation responses
5. WHEN the DigitalOcean_API returns a response, THE AI_Explainer SHALL extract the explanation text
6. THE Explanation_Response SHALL include a summary of the task purpose
7. THE Explanation_Response SHALL include identified relationships to other tasks
8. THE Explanation_Response SHALL include suggested next steps or considerations
9. IF the DigitalOcean_API returns an error, THEN THE AI_Explainer SHALL return a descriptive error message to the user

### Requirement 5: Diagram Generation

**User Story:** As a Lead user, I want to generate visual diagrams that explain task relationships, so that I can visualize complex workflows and dependencies.

#### Acceptance Criteria

1. WHEN a Lead_User requests a diagram for a Task_Node, THE Diagram_Generator SHALL analyze the task and related tasks
2. THE Diagram_Generator SHALL use the GPT_Model to determine the appropriate diagram type (flowchart, dependency graph, or timeline)
3. THE Diagram_Generator SHALL generate diagram data in a structured format (Mermaid syntax or SVG)
4. THE Diagram_Generator SHALL include the target task and all related tasks within the proximity radius
5. THE Diagram_Generator SHALL use consistent visual styling that matches the Board_System theme
6. WHEN a diagram is generated, THE MCP_Server SHALL return the diagram data in the Explanation_Response
7. THE Diagram_Generator SHALL limit diagrams to a maximum of 20 nodes to ensure readability

### Requirement 6: Board Integration for Explanations

**User Story:** As a Lead user, I want to see AI explanations and diagrams directly on the board, so that I can access them in context without leaving my workspace.

#### Acceptance Criteria

1. WHEN an Explanation_Response is received, THE Board_System SHALL create a new node to display the explanation
2. THE Board_System SHALL position the explanation node adjacent to the target Task_Node
3. THE Board_System SHALL style the explanation node distinctly to differentiate it from regular task nodes
4. THE Board_System SHALL include a visual indicator linking the explanation node to the target Task_Node
5. WHEN a diagram is included in the Explanation_Response, THE Board_System SHALL render the diagram within the explanation node
6. THE Board_System SHALL support collapsing and expanding explanation nodes to manage canvas space
7. THE Board_System SHALL persist explanation nodes across sessions using the existing persistence mechanism

### Requirement 7: Explanation Request UI

**User Story:** As a Lead user, I want an intuitive way to request explanations for tasks, so that I can quickly access AI insights without complex interactions.

#### Acceptance Criteria

1. WHEN a Lead_User selects a Task_Node, THE Board_System SHALL display an "Explain with AI" action in the context menu
2. WHEN a Lead_User clicks "Explain with AI", THE Board_System SHALL send an Explanation_Request to the MCP_Server
3. THE Board_System SHALL display a loading indicator while the Explanation_Request is being processed
4. WHEN a Lead_User selects a Task_Node, THE Board_System SHALL display a "Generate Diagram" action in the context menu
5. THE Board_System SHALL disable the "Explain with AI" and "Generate Diagram" actions for non-Lead users
6. THE Board_System SHALL display a tooltip explaining that AI features are available to Lead users only

### Requirement 8: Error Handling and Feedback

**User Story:** As a Lead user, I want clear feedback when explanation requests fail, so that I understand what went wrong and can take corrective action.

#### Acceptance Criteria

1. IF the DigitalOcean_API is unavailable, THEN THE MCP_Server SHALL return an error message indicating the service is temporarily unavailable
2. IF the DigitalOcean_API returns a rate limit error, THEN THE MCP_Server SHALL return an error message indicating the user should retry later
3. IF the Task_Node has insufficient context for explanation, THEN THE AI_Explainer SHALL return a message requesting more task details
4. WHEN an error occurs, THE Board_System SHALL display the error message to the Lead_User in a non-intrusive notification
5. THE MCP_Server SHALL log all errors with sufficient detail for debugging
6. IF the MCP_Server is not configured, THEN THE Board_System SHALL hide the AI explanation features from the UI

### Requirement 9: Performance and Scalability

**User Story:** As a system administrator, I want the AI explanation feature to perform efficiently, so that it does not degrade the overall system performance.

#### Acceptance Criteria

1. WHEN an Explanation_Request is received, THE MCP_Server SHALL respond within 10 seconds under normal load
2. THE MCP_Server SHALL implement request queuing to handle concurrent explanation requests
3. THE MCP_Server SHALL limit each Lead_User to 10 explanation requests per minute to prevent abuse
4. WHEN the rate limit is exceeded, THE MCP_Server SHALL return a 429 Too Many Requests status code
5. THE MCP_Server SHALL cache explanation responses for identical task contexts for 5 minutes
6. THE MCP_Server SHALL use connection pooling for DigitalOcean_API requests to optimize network usage

### Requirement 10: Configuration and Deployment

**User Story:** As a DevOps engineer, I want the MCP server to be easily configurable and deployable, so that it can be integrated into existing infrastructure.

#### Acceptance Criteria

1. THE MCP_Server SHALL read the DigitalOcean_API endpoint from the DO_AI_ENDPOINT environment variable
2. THE MCP_Server SHALL read the DigitalOcean_API key from the DO_AI_API_KEY environment variable
3. THE MCP_Server SHALL read the GPT_Model name from the DO_AI_MODEL environment variable
4. THE MCP_Server SHALL provide a health check endpoint that verifies DigitalOcean_API connectivity
5. THE MCP_Server SHALL support running as a standalone process or embedded within the existing server
6. THE MCP_Server SHALL log startup configuration (excluding sensitive credentials) for verification
7. THE MCP_Server SHALL gracefully handle missing configuration by disabling AI features rather than crashing

### Requirement 11: Audit and Monitoring

**User Story:** As a system administrator, I want to monitor AI explanation usage, so that I can track feature adoption and identify issues.

#### Acceptance Criteria

1. WHEN an Explanation_Request is processed, THE MCP_Server SHALL log the requesting user ID, task ID, and timestamp
2. THE MCP_Server SHALL log the response time for each DigitalOcean_API request
3. THE MCP_Server SHALL log the token count for each explanation generated
4. THE MCP_Server SHALL expose metrics for total explanation requests, successful responses, and error rates
5. THE MCP_Server SHALL log rate limit violations with user ID and timestamp
6. THE MCP_Server SHALL provide a summary endpoint that returns usage statistics for the current day

