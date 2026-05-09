import { describe, it, expect } from "vitest";
import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON = join(__dirname, "../dist/daemon.js");

interface DaemonHandle {
  send(cmd: object): void;
  close(): void;
  collectUntil(predicate: (events: Array<Record<string, unknown>>) => boolean, timeoutMs?: number): Promise<Array<Record<string, unknown>>>;
}

function startDaemon(): { handle: DaemonHandle; proc: ChildProcess } {
  const proc: ChildProcess = spawn("node", [DAEMON], { stdio: ["pipe", "pipe", "pipe"] });
  const events: Array<Record<string, unknown>> = [];
  let buffer = "";

  proc.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        try { events.push(JSON.parse(line) as Record<string, unknown>); } catch { /* skip */ }
      }
    }
  });

  const handle: DaemonHandle = {
    send(cmd: object): void {
      proc.stdin!.write(JSON.stringify(cmd) + "\n");
    },
    close(): void {
      proc.stdin!.end();
    },
    collectUntil(predicate, timeoutMs = 1000): Promise<Array<Record<string, unknown>>> {
      return new Promise((resolve) => {
        const check = (): void => {
          if (predicate(events)) { resolve([...events]); return; }
        };
        const interval = setInterval(check, 50);
        setTimeout(() => { clearInterval(interval); resolve([...events]); }, timeoutMs);
      });
    },
  };

  return { handle, proc };
}

describe("daemon protocol — no API key required", () => {
  it("emits session_ready with empty sessionId on new_session", async () => {
    const { handle } = startDaemon();
    handle.send({ type: "new_session" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "session_ready")
    );
    handle.close();
    const e = evts.find((ev) => ev.type === "session_ready");
    expect(e).toBeDefined();
    expect(e!.sessionId).toBe("");
  });

  it("emits turn_complete on abort when idle", async () => {
    const { handle } = startDaemon();
    handle.send({ type: "abort" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "turn_complete")
    );
    handle.close();
    expect(evts.find((ev) => ev.type === "turn_complete")).toBeDefined();
  });

  it("emits sessions_listed (empty array) for unknown cwd", async () => {
    const { handle } = startDaemon();
    handle.send({ type: "set_cwd", cwd: "/tmp/__no_such_claudian_project__" });
    handle.send({ type: "request_sessions" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "sessions_listed"),
      2000
    );
    handle.close();
    const e = evts.find((ev) => ev.type === "sessions_listed");
    expect(e).toBeDefined();
    expect(JSON.parse(e!.json as string)).toEqual([]);
  });

  it("emits session_ready and session_history_loaded on load_session for unknown session", async () => {
    const { handle } = startDaemon();
    handle.send({ type: "load_session", sessionId: "nonexistent-session-id" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "session_history_loaded"),
      2000
    );
    handle.close();
    expect(evts.find((ev) => ev.type === "session_ready")).toBeDefined();
    const hist = evts.find((ev) => ev.type === "session_history_loaded");
    expect(hist).toBeDefined();
    expect(JSON.parse(hist!.json as string)).toEqual([]);
  });

  it("emits error event on malformed command JSON", async () => {
    const proc: ChildProcess = spawn("node", [DAEMON], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    proc.stdout!.on("data", (c: Buffer) => { stdout += c.toString(); });
    proc.stdin!.write("not json\n");
    await new Promise((r) => setTimeout(r, 300));
    proc.stdin!.end();
    await new Promise((r) => proc.on("close", r));
    const events = stdout.trim().split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; }
    }).filter(Boolean);
    expect(events.find((e) => e!.type === "error")).toBeDefined();
  });
});

const HAS_API_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!HAS_API_KEY)("daemon integration (requires ANTHROPIC_API_KEY)", () => {
  it("send → session_ready + text_ready + turn_complete", async () => {
    const { handle, proc } = startDaemon();
    handle.send({ type: "send", prompt: "Reply with only the word: hello" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "turn_complete"),
      60_000
    );
    handle.close();
    await new Promise((r) => proc.on("close", r));

    expect(evts.find((e) => e.type === "session_ready")).toBeDefined();
    expect(evts.find((e) => e.type === "text_ready")).toBeDefined();
    expect(evts.find((e) => e.type === "turn_complete")).toBeDefined();
  }, 65_000);
});
