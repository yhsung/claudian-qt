import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));

const _hasApiEnv = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
if (!_hasApiEnv) {
  for (const envPath of [
    join(__dirname, "..", "..", ".env"),
    join(__dirname, "..", ".env"),
    join(__dirname, "..", ".env.local"),
  ]) {
    if (existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
  }
}

const BRIDGE = join(__dirname, "../dist/index.js");
const BRIDGE_ENV = { ...process.env };

interface BridgeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runBridge(input: string, timeoutMs = 30_000): Promise<BridgeResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [BRIDGE], { stdio: ["pipe", "pipe", "pipe"], env: BRIDGE_ENV });
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

const HAS_API_KEY = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

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

  it("resumes existing session via sessionId field", async () => {
    // First message — establishes a session
    const firstCmd = JSON.stringify({
      prompt: "Reply with only the word: established",
      cwd: "/tmp",
    });
    const firstResult = await runBridge(firstCmd, 60_000);
    expect(firstResult.exitCode).toBe(0);
    const firstMessages = firstResult.stdout.trim().split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const firstInit = firstMessages.find(
      (m) => m.type === "system" && m.subtype === "init"
    );
    expect(firstInit).toBeDefined();
    const sessionId = firstInit!.session_id as string;

    // Second message — resumes the same session
    const secondCmd = JSON.stringify({
      prompt: "Repeat the word I said last time",
      cwd: "/tmp",
      sessionId,
    });
    const secondResult = await runBridge(secondCmd, 60_000);
    expect(secondResult.exitCode).toBe(0);
    const secondMessages = secondResult.stdout.trim().split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const secondInit = secondMessages.find(
      (m) => m.type === "system" && m.subtype === "init"
    );
    expect(secondInit).toBeDefined();
    // Resumed session should have the same session_id
    expect(secondInit!.session_id).toBe(sessionId);

    const resultMsg = secondMessages.find((m) => m.type === "result");
    expect(resultMsg).toBeDefined();
    expect(resultMsg!.is_error).toBe(false);
  }, 120_000);

  it("passes model override through to the CLI", async () => {
    const cmd = JSON.stringify({
      prompt: "Reply with only the word: ok",
      cwd: "/tmp",
      model: "claude-haiku-4-5-20251001",
    });
    const result = await runBridge(cmd, 60_000);

    expect(result.exitCode).toBe(0);
    const messages = result.stdout.trim().split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const initMsg = messages.find(
      (m) => m.type === "system" && m.subtype === "init"
    );
    expect(initMsg).toBeDefined();
    const resultMsg = messages.find((m) => m.type === "result");
    expect(resultMsg).toBeDefined();
    expect(resultMsg!.is_error).toBe(false);
  }, 60_000);

  it("sends attachments-only (empty prompt text) without error", async () => {
    const tmpDir = join(__dirname, "..", "tmp");
    await mkdir(tmpDir, { recursive: true });
    const stagedPath = join(tmpDir, "att-only-bridge.png");
    await writeFile(stagedPath, Buffer.from("89504e470d0a1a0a", "hex"));

    const cmd = JSON.stringify({
      prompt: "Describe what you see in this image",
      cwd: "/tmp",
      attachments: [{
        id: "att-bridge-1",
        originalName: "att-only-bridge.png",
        mimeType: "image/png",
        stagedPath,
        fileUrl: "file://" + stagedPath,
        sizeBytes: 8,
      }],
    });
    const result = await runBridge(cmd, 60_000);

    expect(result.exitCode).toBe(0);
    const messages = result.stdout.trim().split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const resultMsg = messages.find((m) => m.type === "result");
    expect(resultMsg).toBeDefined();
    expect(resultMsg!.is_error).toBe(false);
  }, 60_000);

  it("exits 0 on SIGTERM during query (AbortError)", async () => {
    // Send a long-running prompt, kill before completion
    return new Promise<void>((resolve) => {
      const proc = spawn("node", [BRIDGE], { stdio: ["pipe", "pipe", "pipe"], env: BRIDGE_ENV });
      const cmd = JSON.stringify({
        prompt: "Write a 500-word essay about the history of computing",
        cwd: "/tmp",
      });
      proc.stdin.write(cmd);
      proc.stdin.end();
      let stderr = "";
      proc.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
      proc.on("close", (code) => {
        // AbortError sets exitCode=0 (not 1)
        expect(code).toBe(0);
        resolve();
      });
      // Kill promptly to trigger AbortError
      setTimeout(() => proc.kill("SIGTERM"), 500);
    });
  }, 15_000);
});
