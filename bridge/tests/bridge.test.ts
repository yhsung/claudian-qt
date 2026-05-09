import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE = join(__dirname, "../dist/index.js");

interface BridgeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runBridge(input: string, timeoutMs = 30_000): Promise<BridgeResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [BRIDGE], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Bridge timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

describe("bridge error handling", () => {
  it("exits 1 and reports error on empty stdin", async () => {
    const result = await runBridge("");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("stdin was empty");
  });

  it("exits 1 and reports error on invalid JSON", async () => {
    const result = await runBridge("not json");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Failed to parse stdin as JSON");
  });

  it("exits 1 on JSON missing required prompt field", async () => {
    const result = await runBridge(JSON.stringify({ cwd: "/tmp" }));
    expect(result.exitCode).toBe(1);
  });
});

const HAS_API_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!HAS_API_KEY)("bridge integration (requires ANTHROPIC_API_KEY)", () => {
  it("emits system/init and result events for a minimal prompt", async () => {
    const cmd = JSON.stringify({
      prompt: "Reply with only the word: hello",
      cwd: "/tmp",
    });
    const result = await runBridge(cmd, 60_000);

    expect(result.exitCode).toBe(0);

    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);

    const messages = lines.map((line) => JSON.parse(line) as Record<string, unknown>);

    const initMsg = messages.find(
      (m) => m.type === "system" && m.subtype === "init"
    );
    expect(initMsg, "Expected a system/init message").toBeDefined();
    expect(typeof initMsg!.session_id).toBe("string");
    expect((initMsg!.session_id as string).length).toBeGreaterThan(0);

    const resultMsg = messages.find((m) => m.type === "result");
    expect(resultMsg, "Expected a result message").toBeDefined();
    expect(resultMsg!.is_error).toBe(false);
  }, 60_000);

  it("emits only valid JSON lines (no non-JSON output mixed in)", async () => {
    const cmd = JSON.stringify({ prompt: "Say: ok", cwd: "/tmp" });
    const result = await runBridge(cmd, 60_000);

    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      expect(() => JSON.parse(line), `Expected valid JSON: ${line.slice(0, 80)}`).not.toThrow();
    }
  }, 60_000);
});
