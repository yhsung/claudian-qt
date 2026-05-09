import { query, AbortError } from "@anthropic-ai/claude-agent-sdk";

interface BridgeCommand {
  prompt: string;
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
  return JSON.parse(chunks.join("").trim()) as BridgeCommand;
}

async function main(): Promise<void> {
  const cmd = await readStdinCommand();

  const abortController = new AbortController();
  const abort = (): void => abortController.abort();
  process.once("SIGTERM", abort);
  process.once("SIGINT", abort);

  try {
    const queryResult = query({
      prompt: cmd.prompt,
      options: {
        abortController,
        cwd: cmd.cwd,
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
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(msg + "\n");
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  process.stderr.write(String(err) + "\n");
  process.exitCode = 1;
});
