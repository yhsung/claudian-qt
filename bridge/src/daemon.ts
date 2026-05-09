import * as readline from "readline";
import * as os from "os";
import { query, AbortError } from "@anthropic-ai/claude-agent-sdk";
import { listSessions, loadSessionHistory } from "./session-history.js";
import type { DaemonCommand, DaemonEvent } from "./protocol.js";

function emit(event: DaemonEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

const state = {
  cwd:       os.homedir(),
  model:     "",
  yolo:      false,
  sessionId: "",
};

let currentAbort: AbortController | null = null;

async function handleSend(prompt: string): Promise<void> {
  if (currentAbort) currentAbort.abort();

  const abortController = new AbortController();
  currentAbort = abortController;

  try {
    const queryResult = query({
      prompt,
      options: {
        abortController,
        cwd:                             state.cwd,
        resume:                          state.sessionId || undefined,
        model:                           state.model     || undefined,
        allowDangerouslySkipPermissions: state.yolo,
      },
    });

    for await (const message of queryResult) {
      if (abortController.signal.aborted) break;
      const m = message as Record<string, unknown>;

      if (m.type === "system" && m.subtype === "init") {
        state.sessionId = m.session_id as string;
        emit({ type: "session_ready", sessionId: state.sessionId });

      } else if (m.type === "assistant") {
        const content = (m.message as Record<string, unknown>).content as Array<Record<string, unknown>>;
        for (const block of content ?? []) {
          if (block.type === "text") {
            emit({ type: "text_ready", text: block.text as string });
          } else if (block.type === "tool_use") {
            emit({ type: "tool_use", name: block.name as string, input: JSON.stringify(block.input) });
          }
        }

      } else if (m.type === "result") {
        if (m.is_error) {
          const errors = m.errors as string[] | undefined;
          const msg = errors?.[0] ?? (m.result as string) ?? (m.subtype as string) ?? "unknown error";
          emit({ type: "error", msg });
        } else {
          emit({ type: "result", data: m });
        }
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
      await handleSend(cmd.prompt);
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
      break;

    case "set_model":
      state.model = cmd.model;
      break;

    case "set_yolo":
      state.yolo = cmd.yolo;
      break;

    case "new_session":
      state.sessionId = "";
      emit({ type: "session_ready", sessionId: "" });
      break;

    case "request_sessions": {
      const sessions = await listSessions(state.cwd);
      emit({ type: "sessions_listed", json: JSON.stringify(sessions) });
      break;
    }

    case "load_session":
      state.sessionId = cmd.sessionId;
      emit({ type: "session_ready", sessionId: cmd.sessionId });
      emit({ type: "session_history_loaded", json: JSON.stringify(await loadSessionHistory(state.cwd, cmd.sessionId)) });
      break;
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
