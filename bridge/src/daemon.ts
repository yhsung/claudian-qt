import * as readline from "readline";
import * as os from "os";
import { query, AbortError } from "@anthropic-ai/claude-agent-sdk";
import { appendManifestTurn, attachmentRoot, finalizeAttachmentsForTurn } from "./attachment-store.js";
import { buildUserMessage } from "./message-input.js";
import { listSessions, loadSessionHistory } from "./session-history.js";
import type { DaemonCommand, DaemonEvent, OutboundAttachment } from "./protocol.js";

function emit(event: DaemonEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

const state = {
  cwd:       os.homedir(),
  model:     "",
  yolo:      false,
  sessionId: "",
  turnIndex: -1,
};

let currentAbort: AbortController | null = null;

async function handleSend(prompt: string, attachments: OutboundAttachment[]): Promise<void> {
  if (currentAbort) currentAbort.abort();

  const abortController = new AbortController();
  currentAbort = abortController;
  let successful = false;

  try {
    const userMessage = await buildUserMessage(prompt, attachments);
    const queryResult = query({
      prompt: (async function* () { yield userMessage; })(),
      options: {
        abortController,
        cwd:                             state.cwd,
        resume:                          state.sessionId || undefined,
        model:                           state.model     || undefined,
        allowDangerouslySkipPermissions: state.yolo,
        includePartialMessages:          true,
      },
    });

    for await (const message of queryResult) {
      if (abortController.signal.aborted) break;
      const m = message as Record<string, unknown>;

      if (m.type === "system" && m.subtype === "init") {
        state.sessionId = m.session_id as string;
        emit({ type: "session_ready", sessionId: state.sessionId });

      } else if (m.type === "stream_event") {
        // Incremental token streaming: emit each text_delta as a separate text_ready
        const event = m.event as Record<string, unknown> | undefined;
        if (!event) continue;
        if (
          event.type === "content_block_delta" &&
          (event.delta as Record<string, unknown>)?.type === "text_delta"
        ) {
          const text = (event.delta as Record<string, unknown>).text as string;
          if (text) emit({ type: "text_ready", text });
        }

      } else if (m.type === "assistant") {
        // Text was already streamed token-by-token via stream_event; only emit tool_use here.
        const msgObj = m.message as Record<string, unknown> | undefined;
        const content = msgObj?.content as Array<Record<string, unknown>> | undefined;
        for (const block of content ?? []) {
          if (block.type === "tool_use") {
            emit({ type: "tool_use", name: block.name as string, input: JSON.stringify(block.input) });
          }
        }

      } else if (m.type === "result") {
        if (m.is_error) {
          const errors = m.errors as string[] | undefined;
          const msg = errors?.[0] ?? (m.result as string) ?? (m.subtype as string) ?? "unknown error";
          emit({ type: "error", msg });
        } else {
          successful = true;
          emit({ type: "result", data: m });
        }
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
      await handleSend(cmd.prompt, cmd.attachments ?? []);
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
      state.cwd       = cmd.cwd;
      state.sessionId = "";
      state.turnIndex = -1;
      break;

    case "set_model":
      state.model = cmd.model;
      break;

    case "set_yolo":
      state.yolo = cmd.yolo;
      break;

    case "new_session":
      state.sessionId = "";
      state.turnIndex = -1;
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
