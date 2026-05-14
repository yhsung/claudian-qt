import * as readline from "readline";
import * as os from "os";
import { query, startup, AbortError } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool, PermissionResult, WarmQuery } from "@anthropic-ai/claude-agent-sdk";
import { appendManifestTurn, attachmentRoot, finalizeAttachmentsForTurn } from "./attachment-store.js";
import { buildUserMessage } from "./message-input.js";
import { listSessions, loadSessionHistory, renameSession } from "./session-history.js";
import { unlink } from "fs/promises";
import { join } from "path";
import type { DaemonCommand, DaemonEvent, OutboundAttachment, AskUserQuestionItem } from "./protocol.js";

function emit(event: DaemonEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

const state = {
  cwd:                os.homedir(),
  model:              "",
  yolo:               false,
  permissionMode:     "default",
  sessionId:          "",
  turnIndex:          -1,
  sessionPermissions: {} as Record<string, boolean>,
};

let currentAbort: AbortController | null = null;
let warmQueryPromise: Promise<WarmQuery | null> | null = null;
let activeQuery: ReturnType<typeof query> | null = null;

// Pending permission promises keyed by requestId
const pendingPermissions = new Map<string, {
  resolve: (result: PermissionResult) => void;
  toolName: string;
  originalInput?: Record<string, unknown>;
}>();

function scheduleWarmup(): void {
  warmQueryPromise = startup({
    options: { cwd: state.cwd },
    initializeTimeoutMs: 12000,
  }).catch(() => null);
}
scheduleWarmup();

// Build a canUseTool callback for a given send invocation.
// Must always be provided so the SDK adds --permission-prompt-tool stdio to the CLI;
// without that flag the CLI has no IPC channel for permissions and fails them even in
// YOLO mode. In YOLO mode the callback auto-approves instead of showing the dialog.
function makeCanUseTool(yoloMode: boolean): CanUseTool {
  return (toolName, input, options) => {
    return new Promise<PermissionResult>((resolve) => {
      if (options.signal.aborted) {
        resolve({ behavior: "deny", message: "Request aborted." });
        return;
      }

      // AskUserQuestion: Claude is asking the user clarifying questions.
      if (toolName === "AskUserQuestion") {
        const requestId = `ask_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const typedInput = input as Record<string, unknown>;
        pendingPermissions.set(requestId, {
          resolve,
          toolName,
          originalInput: typedInput,
        });
        options.signal.addEventListener("abort", () => {
          if (pendingPermissions.delete(requestId)) {
            resolve({ behavior: "deny", message: "Request aborted." });
          }
        }, { once: true });
        emit({
          type: "ask_user_question",
          requestId,
          questions: (typedInput.questions ?? []) as AskUserQuestionItem[],
        });
        return;
      }

      if (yoloMode) {
        resolve({ behavior: "allow", updatedInput: {} });
        return;
      }
      if (state.sessionPermissions[toolName]) {
        resolve({ behavior: "allow", updatedInput: {} });
        return;
      }
      const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      pendingPermissions.set(requestId, { resolve, toolName });

      options.signal.addEventListener("abort", () => {
        if (pendingPermissions.delete(requestId)) {
          resolve({ behavior: "deny", message: "Request aborted." });
        }
      }, { once: true });

      emit({
        type: "permission_request",
        requestId,
        toolName,
        input: JSON.stringify(input),
        title:          options.title,
        description:    options.description,
        displayName:    options.displayName,
        decisionReason: options.decisionReason,
        blockedPath:    options.blockedPath,
      });
    });
  };
}

async function handleSend(prompt: string, attachments: OutboundAttachment[], model?: string, yolo?: boolean): Promise<void> {
  if (currentAbort) currentAbort.abort();

  const abortController = new AbortController();
  currentAbort = abortController;
  let successful = false;

  const effectiveYolo = yolo ?? state.yolo;

  // Cache token accumulator for this turn (captured from message_delta stream events).
  let turnCacheRead = 0;
  let turnCacheCreated = 0;

  try {
    const userMessage = await buildUserMessage(prompt, attachments);

    // Check if we have a pre-warmed query and this is a fresh session
    const warm = (warmQueryPromise && !state.sessionId) ? await warmQueryPromise : null;
    warmQueryPromise = null;

    let queryResult: ReturnType<typeof query>;

    if (warm && !state.sessionId) {
      queryResult = warm.query(
        (async function* () { yield userMessage; })()
      );
      scheduleWarmup();
    } else {
      if (warm) warm.close();
      queryResult = query({
        prompt: (async function* () { yield userMessage; })(),
        options: {
          abortController,
          cwd:                             state.cwd,
          resume:                          state.sessionId || undefined,
          model:                           (model ?? state.model) || undefined,
          allowDangerouslySkipPermissions: effectiveYolo,
          permissionMode:                  effectiveYolo ? "bypassPermissions" : (state.permissionMode as any) || "default",
          includePartialMessages:          true,
          forwardSubagentText:             true,
          canUseTool:                      makeCanUseTool(effectiveYolo),
        },
      });
    }
    activeQuery = queryResult;

    for await (const message of queryResult) {
      if (abortController.signal.aborted) break;
      const m = message as Record<string, unknown>;

      if (m.type === "system" && m.subtype === "init") {
        state.sessionId = m.session_id as string;
        emit({ type: "session_ready", sessionId: state.sessionId });
        const fastModeState = (m as Record<string, unknown>).fast_mode_state as string | undefined;
        if (fastModeState) {
          emit({ type: "fast_mode_state", state: fastModeState as "off" | "cooldown" | "on" });
        }

      } else if (m.type === "stream_event") {
        const event = m.event as Record<string, unknown> | undefined;
        if (!event) continue;
        const delta = event.delta as Record<string, unknown> | undefined;

        if (event.type === "content_block_delta") {
          if (delta?.type === "text_delta") {
            const text = delta.text as string;
            if (text) emit({ type: "text_ready", text });
          } else if (delta?.type === "thinking_delta") {
            const text = delta.thinking as string;
            if (text) emit({ type: "thinking_chunk", text });
          }
        } else if (event.type === "message_delta") {
          // Capture cache token usage for the statusline badge.
          const usage = (event.usage as Record<string, unknown>) || {};
          turnCacheRead    += Number(usage.cache_read_input_tokens)    || 0;
          turnCacheCreated += Number(usage.cache_creation_input_tokens) || 0;
        } else if (event.type === "tool_progress") {
          const tp = event as Record<string, unknown>;
          emit({
            type: "tool_progress",
            id: String(tp.tool_use_id || tp.id || ""),
            name: String(tp.tool_name || ""),
            elapsedSeconds: Number(tp.elapsed_time_seconds || 0),
          });
        }

      } else if (m.type === "assistant") {
        const msgObj = m.message as Record<string, unknown> | undefined;
        const content = msgObj?.content as Array<Record<string, unknown>> | undefined;
        const parentToolUseId = m.parent_tool_use_id as string | null | undefined;

        if (parentToolUseId) {
          // Sub-agent message — collect text blocks and surface them as a unit.
          const subText = (content ?? [])
            .filter(b => b.type === "text")
            .map(b => b.text as string)
            .join("");
          if (subText) emit({ type: "sub_agent_message", parentToolUseId, text: subText });
        } else {
          // Main agent — text already streamed via stream_event; emit tool_use blocks only.
          for (const block of content ?? []) {
            if (block.type === "tool_use") {
              emit({ type: "tool_use", id: block.id as string, name: block.name as string, input: JSON.stringify(block.input) });
            }
          }
        }

      } else if (m.type === "user") {
        // Tool results returned to Claude after tool execution.
        const msgObj = m.message as Record<string, unknown> | undefined;
        const content = msgObj?.content as Array<Record<string, unknown>> | undefined;
        for (const block of content ?? []) {
          if (block.type === "tool_result") {
            const toolContent = block.content;
            let text: string;
            if (Array.isArray(toolContent)) {
              text = (toolContent as Array<Record<string, unknown>>)
                .filter(c => c.type === "text")
                .map(c => c.text as string)
                .join("\n");
            } else {
              text = String(toolContent ?? "");
            }
            emit({
              type: "tool_result",
              toolUseId: block.tool_use_id as string,
              content: text.slice(0, 4000),
              isError: block.is_error === true,
            });
          }
        }

      } else if (m.type === "result") {
        if (m.is_error) {
          const errors = m.errors as string[] | undefined;
          const msg = errors?.[0] ?? (m.result as string) ?? (m.subtype as string) ?? "unknown error";
          emit({ type: "error", msg });
        } else {
          successful = true;
          emit({ type: "result", data: { ...m, cacheReadTokens: turnCacheRead, cacheCreatedTokens: turnCacheCreated } });
        }

      } else if (m.type === "rate_limit") {
        const r = m as Record<string, unknown>;
        const rli = r.rate_limit_info as Record<string, unknown> | undefined;
        emit({
          type: "rate_limit",
          status: String(rli?.status || "allowed") as "allowed" | "allowed_warning" | "rejected",
          resetsAt: rli?.resetsAt ? String(rli.resetsAt) : undefined,
          rateLimitType: rli?.rateLimitType ? String(rli.rateLimitType) : undefined,
          utilization: typeof rli?.utilization === "number" ? rli.utilization : undefined,
        });

      } else if (m.type === "prompt_suggestion") {
        const ps = m as Record<string, unknown>;
        emit({ type: "prompt_suggestion", suggestion: String(ps.suggestion || "") });

      } else if (m.type === "compact_boundary") {
        const cb = m as Record<string, unknown>;
        const meta = cb.compact_metadata as Record<string, unknown> | undefined;
        emit({
          type: "compact_boundary",
          preTokens: Number(cb.pre_tokens || 0),
          postTokens: Number(cb.post_tokens || 0),
          durationMs: Number(cb.duration_ms || 0),
          trigger: String(meta?.trigger || "auto") as "manual" | "auto",
        });
      }
    }

    if (successful) {
      const turnIndex = state.turnIndex + 1;
      state.turnIndex = turnIndex;
      if (attachments.length > 0 && state.sessionId) {
        const finalized = await finalizeAttachmentsForTurn({
          rootDir: attachmentRoot(),
          sessionId: state.sessionId,
          turnIndex,
          attachments,
        });
        await appendManifestTurn({
          rootDir: attachmentRoot(),
          sessionId: state.sessionId,
          turnIndex,
          attachments: finalized,
        }).catch((err) => {
          // Manifest write failed; log but do not surface as fatal — attachments are finalized on disk
          emit({ type: "error", msg: `Warning: failed to write attachment manifest: ${err instanceof Error ? err.message : String(err)}` });
        });
      }
    }
  } catch (err) {
    if (!(err instanceof AbortError)) {
      emit({ type: "error", msg: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    if (currentAbort === abortController) currentAbort = null;
    emit({ type: "turn_complete" });
  }
}

async function handleCommand(cmd: DaemonCommand): Promise<void> {
  switch (cmd.type) {
    case "send":
      await handleSend(cmd.prompt, cmd.attachments ?? [], cmd.model, cmd.yolo);
      break;

    case "abort":
      if (currentAbort) {
        currentAbort.abort();
        // turn_complete will be emitted by handleSend's finally block
      } else {
        emit({ type: "turn_complete" });
      }
      break;

    case "set_cwd":
      state.cwd                = cmd.cwd;
      state.sessionId          = "";
      state.turnIndex          = -1;
      state.sessionPermissions = {};
      break;

    case "set_model":
      state.model = cmd.model;
      break;

    case "set_yolo":
      state.yolo = cmd.yolo;
      break;

    case "new_session":
      state.sessionId          = "";
      state.turnIndex          = -1;
      state.sessionPermissions = {};
      emit({ type: "session_ready", sessionId: "" });
      break;

    case "request_sessions": {
      const sessions = await listSessions(state.cwd);
      emit({ type: "sessions_listed", json: JSON.stringify(sessions) });
      break;
    }

    case "load_session": {
      state.sessionId = cmd.sessionId;
      const history = await loadSessionHistory(state.cwd, cmd.sessionId);
      state.turnIndex = history.filter((t) => t.role === "user").length - 1;
      emit({ type: "session_ready", sessionId: cmd.sessionId });
      emit({ type: "session_history_loaded", json: JSON.stringify(history) });
      break;
    }

    case "delete_session": {
      const sessionFile = join(
        os.homedir(), ".claude", "projects",
        state.cwd.replace(/\//g, "-"),
        cmd.sessionId + ".jsonl"
      );
      try { await unlink(sessionFile); } catch { /* already gone */ }
      const sessions = await listSessions(state.cwd);
      emit({ type: "sessions_listed", json: JSON.stringify(sessions) });
      break;
    }

    case "rename_session": {
      await renameSession(state.cwd, cmd.sessionId, cmd.name);
      emit({ type: "session_renamed", sessionId: cmd.sessionId, name: cmd.name });
      const sessions = await listSessions(state.cwd);
      emit({ type: "sessions_listed", json: JSON.stringify(sessions) });
      break;
    }

    case "set_permission_mode":
      state.permissionMode = cmd.mode;
      break;

    case "request_models": {
      try {
        const tempQuery = query({
          prompt: (async function* () { /* empty */ })(),
          options: {
            cwd: state.cwd,
            maxTurns: 0,
            allowDangerouslySkipPermissions: true,
          },
        });
        const models = await tempQuery.supportedModels();
        emit({
          type: "models_listed",
          models: models.map((m: Record<string, unknown>) => ({
            id: String(m.id ?? m.modelId ?? ""),
            displayName: m.displayName ? String(m.displayName) : undefined,
          })),
        });
      } catch (err) {
        emit({ type: "models_listed", models: [] });
      }
      break;
    }

    case "permission_response": {
      const pending = pendingPermissions.get(cmd.requestId);
      if (pending) {
        pendingPermissions.delete(cmd.requestId);
        if (cmd.allow) {
          if (cmd.alwaysAllow) {
            state.sessionPermissions[pending.toolName] = true;
          }
          pending.resolve({ behavior: "allow", updatedInput: {} });
        } else {
          pending.resolve({ behavior: "deny", message: "Permission denied by user." });
        }
      }
      break;
    }

    case "ask_user_response": {
      const pending = pendingPermissions.get(cmd.requestId);
      if (pending) {
        pendingPermissions.delete(cmd.requestId);
        pending.resolve({
          behavior: "allow",
          updatedInput: {
            questions: pending.originalInput?.questions ?? [],
            answers: cmd.answers,
          },
        });
      }
      break;
    }
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line: string) => {
  if (!line.trim()) return;
  let cmd: DaemonCommand;
  try {
    cmd = JSON.parse(line) as DaemonCommand;
  } catch {
    emit({ type: "error", msg: `Failed to parse command: ${line.slice(0, 100)}` });
    return;
  }
  handleCommand(cmd).catch((err: unknown) => {
    emit({ type: "error", msg: String(err) });
  });
});

rl.on("close", () => process.exit(0));
