export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export interface OutboundAttachment {
  mediaType: ImageMediaType;
  stagedPath: string;
}

export interface HistoryAttachment {
  mediaType: ImageMediaType;
  stagedPath: string;
}

export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
  attachments?: HistoryAttachment[];
}

export type DaemonCommand =
  | { type: "send"; prompt: string; attachments?: OutboundAttachment[] }
  | { type: "abort" }
  | { type: "set_cwd"; cwd: string }
  | { type: "set_model"; model: string }
  | { type: "set_yolo"; yolo: boolean }
  | { type: "new_session" }
  | { type: "request_sessions" }
  | { type: "load_session"; sessionId: string };

export type DaemonEvent =
  | { type: "text_ready"; text: string }
  | { type: "tool_use"; name: string; input: string }
  | { type: "turn_complete" }
  | { type: "session_ready"; sessionId: string }
  | { type: "error"; msg: string }
  | { type: "sessions_listed"; json: string }
  | { type: "session_history_loaded"; json: string }
  | { type: "result"; data: Record<string, unknown> };
