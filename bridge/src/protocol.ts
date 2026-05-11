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
  | { type: "delete_session"; sessionId: string }
  | { type: "rename_session"; sessionId: string; name: string }
  | { type: "set_permission_mode"; mode: string };

export type DaemonEvent =
  | { type: "text_ready"; text: string }
  | { type: "thinking_chunk"; text: string }
  | { type: "tool_use"; id: string; name: string; input: string }
  | { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
  | { type: "sub_agent_message"; parentToolUseId: string; text: string }
  | { type: "permission_request"; requestId: string; toolName: string; input: string; title?: string; description?: string; displayName?: string; decisionReason?: string; blockedPath?: string }
  | { type: "turn_complete" }
  | { type: "session_ready"; sessionId: string }
  | { type: "error"; msg: string }
  | { type: "sessions_listed"; json: string }
  | { type: "session_renamed"; sessionId: string; name: string }
  | { type: "session_history_loaded"; json: string }
  | { type: "result"; data: Record<string, unknown> };
