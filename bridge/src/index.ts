import { query, AbortError } from "@anthropic-ai/claude-agent-sdk";
import { buildUserMessage } from "./message-input.js";
import type { OutboundAttachment } from "./protocol.js";

interface BridgeCommand {
  prompt: string;
  attachments?: OutboundAttachment[];
  cwd?: string;
  sessionId?: string;
  model?: string;
  yolo?: boolean;
}

async function readStdinCommand(): Promise<BridgeCommand> {
  const chunks: string[] = [];
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    chunks.push(chunk as string);
  }
  const raw = chunks.join("").trim();
  if (!raw) throw new Error("stdin was empty — expected a JSON BridgeCommand");
  try {
    return JSON.parse(raw) as BridgeCommand;
  } catch {
    throw new Error(`Failed to parse stdin as JSON: ${raw.slice(0, 200)}`);
  }
}

async function main(): Promise<void> {
  const abortController = new AbortController();
  const abort = (): void => abortController.abort();
  process.once("SIGTERM", abort);
  process.once("SIGINT", abort);

  try {
    const cmd = await readStdinCommand();

    if ((!cmd.prompt || !cmd.prompt.trim()) && !(cmd.attachments && cmd.attachments.length > 0)) {
      throw new Error("Missing required input: provide prompt text and/or attachments");
    }

    const userMessage = await buildUserMessage(cmd.prompt ?? "", cmd.attachments ?? []);
    const queryResult = query({
      prompt: (async function* () { yield userMessage; })(),
      options: {
        abortController,
        cwd: cmd.cwd || undefined,
        resume: cmd.sessionId || undefined,
        model: cmd.model || undefined,
        allowDangerouslySkipPermissions: cmd.yolo ?? false,
      },
    });

    for await (const message of queryResult) {
      process.stdout.write(JSON.stringify(message) + "\n");
    }
  } catch (err) {
    if (err instanceof AbortError) {
      process.exitCode = 0;
      return;
    }
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(msg + "\n");
    process.exitCode = 1;
  } finally {
    process.off("SIGTERM", abort);
    process.off("SIGINT", abort);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(String(err) + "\n");
  process.exitCode = 1;
});
