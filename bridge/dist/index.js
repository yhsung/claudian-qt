import { query, AbortError } from "@anthropic-ai/claude-agent-sdk";
async function readStdinCommand() {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    const raw = chunks.join("").trim();
    if (!raw)
        throw new Error("stdin was empty — expected a JSON BridgeCommand");
    try {
        return JSON.parse(raw);
    }
    catch {
        throw new Error(`Failed to parse stdin as JSON: ${raw.slice(0, 200)}`);
    }
}
async function main() {
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    process.once("SIGTERM", abort);
    process.once("SIGINT", abort);
    try {
        const cmd = await readStdinCommand();
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
    }
    catch (err) {
        if (err instanceof AbortError) {
            process.exitCode = 0;
            return;
        }
        const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
        process.stderr.write(msg + "\n");
        process.exitCode = 1;
    }
    finally {
        process.off("SIGTERM", abort);
        process.off("SIGINT", abort);
    }
}
main().catch((err) => {
    process.stderr.write(String(err) + "\n");
    process.exitCode = 1;
});
