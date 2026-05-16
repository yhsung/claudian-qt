export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export interface OutboundAttachment {
  id: string;
  originalName: string;
  mimeType: ImageMediaType;
  stagedPath: string;
  fileUrl: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}

export interface HistoryAttachment {
  id: string;
  originalName: string;
  mimeType: ImageMediaType;
  relativePath: string;
  fileUrl: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}

export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
  attachments: HistoryAttachment[];
}

export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: Array<{ label: string; description: string; preview?: string }>;
  multiSelect: boolean;
}

export interface McpServerSpec {
  type?: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface AgentSpec {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  maxTurns?: number;
  permissionMode?: string;
}

export interface RewindResult {
  changedFiles: string[];
  restoredFiles: string[];
  failedFiles: string[];
}

export type DaemonCommand =
  | { type: "send"; prompt: string; attachments?: OutboundAttachment[]; model?: string; yolo?: boolean }
  | { type: "abort" }
  | { type: "set_cwd"; cwd: string }
  | { type: "set_model"; model: string }
  | { type: "set_yolo"; yolo: boolean }
  | { type: "new_session" }
  | { type: "request_sessions" }
  | { type: "load_session"; sessionId: string }
  | { type: "permission_response"; requestId: string; allow: boolean; alwaysAllow: boolean }
  | { type: "ask_user_response"; requestId: string; answers: Record<string, string | string[]> }
  | { type: "delete_session"; sessionId: string }
  | { type: "rename_session"; sessionId: string; name: string }
  | { type: "set_permission_mode"; mode: string }
  | { type: "set_thinking"; thinkingType: "disabled" | "adaptive" | "enabled"; budgetTokens?: number }
  | { type: "set_run_options"; maxTurns?: number; maxBudgetUsd?: number; effort?: "low" | "medium" | "high" | "xhigh" | "max"; systemPrompt?: string }
  | { type: "set_tool_controls"; allowedTools?: string[]; disallowedTools?: string[] }
  | { type: "fork_session" }
  | { type: "request_models" }
  | { type: "request_account_info" }
  | { type: "set_mcp_servers"; servers: Record<string, McpServerSpec> }
  | { type: "set_agents"; agents: Record<string, AgentSpec> }
  | { type: "rewind_files"; userMessageId: string; dryRun?: boolean };

export type DaemonEvent =
  | { type: "text_ready"; text: string }
  | { type: "thinking_chunk"; text: string }
  | { type: "tool_use"; id: string; name: string; input: string }
  | { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
  | { type: "sub_agent_message"; parentToolUseId: string; text: string }
  | { type: "permission_request"; requestId: string; toolName: string; input: string; title?: string; description?: string; displayName?: string; decisionReason?: string; blockedPath?: string }
  | { type: "ask_user_question"; requestId: string; questions: AskUserQuestionItem[] }
  | { type: "turn_complete" }
  | { type: "session_ready"; sessionId: string }
  | { type: "error"; msg: string }
  | { type: "sessions_listed"; json: string }
  | { type: "session_renamed"; sessionId: string; name: string }
  | { type: "session_history_loaded"; json: string }
  | { type: "session_forked"; newSessionId: string }
  | { type: "result"; data: Record<string, unknown> }
  | { type: "tool_progress"; id: string; name: string; elapsedSeconds: number }
  | { type: "rate_limit"; status: "allowed" | "allowed_warning" | "rejected"; resetsAt?: string; rateLimitType?: string; utilization?: number }
  | { type: "fast_mode_state"; state: "off" | "cooldown" | "on" }
  | { type: "prompt_suggestion"; suggestion: string }
  | { type: "compact_boundary"; preTokens: number; postTokens: number; durationMs: number; trigger: "manual" | "auto" }
  | { type: "models_listed"; models: Array<{ id: string; displayName?: string }> }
  | { type: "account_info"; email?: string; plan?: string; subscriptionType?: string; apiProvider?: string }
  | { type: "notification"; message: string; notificationType: string }
  | ({ type: "rewind_result" } & RewindResult);
