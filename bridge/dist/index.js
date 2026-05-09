import { query, AbortError } from "@anthropic-ai/claude-agent-sdk";
async function readStdinCommand() {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    return JSON.parse(chunks.join("").trim());
}
async function main() {
    const cmd = await readStdinCommand();
    const abortController = new AbortController();
    const abort = () => abortController.abort();
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
    }
    catch (err) {
        if (err instanceof AbortError) {
            process.exitCode = 0;
            return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(msg + "\n");
        process.exitCode = 1;
    }
}
main().catch((err) => {
    process.stderr.write(String(err) + "\n");
    process.exitCode = 1;
});
