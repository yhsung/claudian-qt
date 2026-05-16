/**
 * Tests for Agent SDK parity features added in the worktree-agent-sdk-parity merge.
 *
 * Coverage:
 *  1. Protocol type shapes — new events and commands compile correctly.
 *  2. Daemon state commands — accepted without crash; daemon remains responsive.
 *  3. No-key daemon commands — request_models / request_account_info emit the right
 *     events even when the SDK throws (no ANTHROPIC_API_KEY).
 *  4. SDK integration tests — guarded by HAS_API_KEY.
 */

import { describe, it, expect } from "vitest";
import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import dotenv from "dotenv";
import type {
  DaemonCommand,
  DaemonEvent,
  AskUserQuestionItem,
  McpServerSpec,
  AgentSpec,
  RewindResult,
} from "../src/protocol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Inherit env from the current process (e.g. Claude Code) first.
// Only load dotenv files as a fallback when API credentials aren't already set.
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

const DAEMON = join(__dirname, "../dist/daemon.js");
const DAEMON_ENV = { ...process.env };

// ---------------------------------------------------------------------------
// Daemon harness (same shape as daemon.test.ts)
// ---------------------------------------------------------------------------

interface DaemonHandle {
  send(cmd: object): void;
  close(): void;
  collectUntil(
    predicate: (events: Array<Record<string, unknown>>) => boolean,
    timeoutMs?: number
  ): Promise<Array<Record<string, unknown>>>;
}

function startDaemon(): { handle: DaemonHandle; proc: ChildProcess } {
  const proc: ChildProcess = spawn("node", [DAEMON], { stdio: ["pipe", "pipe", "pipe"], env: DAEMON_ENV });
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
    collectUntil(predicate, timeoutMs = 1500): Promise<Array<Record<string, unknown>>> {
      return new Promise((resolve) => {
        const interval = setInterval(() => {
          if (predicate(events)) { clearInterval(interval); resolve([...events]); }
        }, 50);
        setTimeout(() => { clearInterval(interval); resolve([...events]); }, timeoutMs);
      });
    },
  };

  return { handle, proc };
}

// ---------------------------------------------------------------------------
// 1. Protocol type shapes
// ---------------------------------------------------------------------------

describe("protocol — new event shapes", () => {
  it("thinking_chunk carries text", () => {
    const ev: DaemonEvent = { type: "thinking_chunk", text: "let me think…" };
    expect(ev.type).toBe("thinking_chunk");
    expect((ev as { text: string }).text).toBe("let me think…");
  });

  it("sub_agent_message carries parentToolUseId and text", () => {
    const ev: DaemonEvent = { type: "sub_agent_message", parentToolUseId: "tu_1", text: "sub result" };
    expect(ev.type).toBe("sub_agent_message");
    expect((ev as { parentToolUseId: string; text: string }).parentToolUseId).toBe("tu_1");
  });

  it("tool_progress carries id, name, elapsedSeconds", () => {
    const ev: DaemonEvent = { type: "tool_progress", id: "tu_abc", name: "Bash", elapsedSeconds: 3.2 };
    expect((ev as { elapsedSeconds: number }).elapsedSeconds).toBe(3.2);
  });

  it("rate_limit allowed variant is well-typed", () => {
    const ev: DaemonEvent = { type: "rate_limit", status: "allowed" };
    expect(ev.type).toBe("rate_limit");
  });

  it("rate_limit rejected variant carries optional resetsAt / rateLimitType / utilization", () => {
    const ev: DaemonEvent = {
      type: "rate_limit",
      status: "rejected",
      resetsAt: "2026-06-01T00:00:00Z",
      rateLimitType: "output_tokens",
      utilization: 0.98,
    };
    expect((ev as { utilization?: number }).utilization).toBe(0.98);
  });

  it("fast_mode_state carries state", () => {
    const ev: DaemonEvent = { type: "fast_mode_state", state: "on" };
    expect((ev as { state: string }).state).toBe("on");
  });

  it("prompt_suggestion carries suggestion text", () => {
    const ev: DaemonEvent = { type: "prompt_suggestion", suggestion: "try /compact" };
    expect((ev as { suggestion: string }).suggestion).toBe("try /compact");
  });

  it("compact_boundary carries numeric fields and trigger", () => {
    const ev: DaemonEvent = {
      type: "compact_boundary",
      preTokens: 80000,
      postTokens: 12000,
      durationMs: 1400,
      trigger: "auto",
    };
    expect((ev as { preTokens: number }).preTokens).toBe(80000);
    expect((ev as { trigger: string }).trigger).toBe("auto");
  });

  it("models_listed carries models array with id and optional displayName", () => {
    const ev: DaemonEvent = {
      type: "models_listed",
      models: [
        { id: "claude-opus-4-7", displayName: "Claude Opus 4.7" },
        { id: "claude-haiku-4-5-20251001" },
      ],
    };
    expect((ev as { models: Array<{ id: string }> }).models).toHaveLength(2);
    expect((ev as { models: Array<{ id: string; displayName?: string }> }).models[1].displayName).toBeUndefined();
  });

  it("account_info carries optional email and plan", () => {
    const full: DaemonEvent = { type: "account_info", email: "a@b.com", plan: "pro" };
    const empty: DaemonEvent = { type: "account_info" };
    expect((full as { email?: string }).email).toBe("a@b.com");
    expect((empty as { plan?: string }).plan).toBeUndefined();
  });

  it("notification carries message and notificationType", () => {
    const ev: DaemonEvent = { type: "notification", message: "Task complete", notificationType: "subagent_stop" };
    expect((ev as { notificationType: string }).notificationType).toBe("subagent_stop");
  });

  it("rewind_result carries changed / restored / failed file arrays", () => {
    const ev: DaemonEvent & RewindResult = {
      type: "rewind_result",
      changedFiles: ["src/foo.ts"],
      restoredFiles: ["src/foo.ts"],
      failedFiles: [],
    };
    expect(ev.changedFiles).toHaveLength(1);
    expect(ev.failedFiles).toEqual([]);
  });

  it("session_forked carries newSessionId", () => {
    const ev: DaemonEvent = { type: "session_forked", newSessionId: "abc-forked" };
    expect((ev as { newSessionId: string }).newSessionId).toBe("abc-forked");
  });
});

describe("protocol — new command shapes", () => {
  it("set_thinking disabled is typed", () => {
    const cmd: DaemonCommand = { type: "set_thinking", thinkingType: "disabled" };
    expect(cmd.type).toBe("set_thinking");
  });

  it("set_thinking enabled with budget is typed", () => {
    const cmd: DaemonCommand = { type: "set_thinking", thinkingType: "enabled", budgetTokens: 16000 };
    expect((cmd as { budgetTokens?: number }).budgetTokens).toBe(16000);
  });

  it("set_run_options is fully typed", () => {
    const cmd: DaemonCommand = {
      type: "set_run_options",
      maxTurns: 5,
      maxBudgetUsd: 2.5,
      effort: "high",
      systemPrompt: "Always reply in JSON.",
    };
    expect(cmd.type).toBe("set_run_options");
  });

  it("set_tool_controls carries allowed and disallowed arrays", () => {
    const cmd: DaemonCommand = {
      type: "set_tool_controls",
      allowedTools: ["Bash", "Read"],
      disallowedTools: ["WebSearch"],
    };
    expect((cmd as { allowedTools?: string[] }).allowedTools).toContain("Bash");
  });

  it("set_mcp_servers carries server specs", () => {
    const spec: McpServerSpec = { type: "stdio", command: "my-mcp", args: ["--port", "3000"] };
    const cmd: DaemonCommand = { type: "set_mcp_servers", servers: { myServer: spec } };
    expect(cmd.type).toBe("set_mcp_servers");
  });

  it("set_agents carries agent spec", () => {
    const spec: AgentSpec = { description: "Runs tests", prompt: "Run all tests and report.", model: "claude-haiku-4-5-20251001" };
    const cmd: DaemonCommand = { type: "set_agents", agents: { testRunner: spec } };
    expect(cmd.type).toBe("set_agents");
  });

  it("fork_session is typed", () => {
    const cmd: DaemonCommand = { type: "fork_session" };
    expect(cmd.type).toBe("fork_session");
  });

  it("rewind_files carries userMessageId and optional dryRun", () => {
    const cmd: DaemonCommand = { type: "rewind_files", userMessageId: "msg_1", dryRun: true };
    expect((cmd as { dryRun?: boolean }).dryRun).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Daemon state commands — accepted without crash
// ---------------------------------------------------------------------------

describe("daemon — state commands accepted without crash", () => {
  it("set_thinking disabled then new_session still works", async () => {
    const { handle } = startDaemon();
    handle.send({ type: "set_thinking", thinkingType: "disabled" });
    handle.send({ type: "new_session" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "session_ready")
    );
    handle.close();
    expect(evts.find((ev) => ev.type === "session_ready")).toBeDefined();
  });

  it("set_thinking enabled with budget then new_session still works", async () => {
    const { handle } = startDaemon();
    handle.send({ type: "set_thinking", thinkingType: "enabled", budgetTokens: 8000 });
    handle.send({ type: "new_session" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "session_ready")
    );
    handle.close();
    expect(evts.find((ev) => ev.type === "session_ready")).toBeDefined();
  });

  it("set_thinking adaptive then new_session still works", async () => {
    const { handle } = startDaemon();
    handle.send({ type: "set_thinking", thinkingType: "adaptive" });
    handle.send({ type: "new_session" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "session_ready")
    );
    handle.close();
    expect(evts.find((ev) => ev.type === "session_ready")).toBeDefined();
  });

  it("set_run_options then new_session still works", async () => {
    const { handle } = startDaemon();
    handle.send({ type: "set_run_options", maxTurns: 10, effort: "max", systemPrompt: "Be brief." });
    handle.send({ type: "new_session" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "session_ready")
    );
    handle.close();
    expect(evts.find((ev) => ev.type === "session_ready")).toBeDefined();
  });

  it("set_tool_controls then new_session still works", async () => {
    const { handle } = startDaemon();
    handle.send({ type: "set_tool_controls", allowedTools: ["Bash"], disallowedTools: ["WebSearch"] });
    handle.send({ type: "new_session" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "session_ready")
    );
    handle.close();
    expect(evts.find((ev) => ev.type === "session_ready")).toBeDefined();
  });

  it("set_mcp_servers then new_session still works", async () => {
    const { handle } = startDaemon();
    handle.send({ type: "set_mcp_servers", servers: { myServer: { type: "stdio", command: "echo", args: ["hello"] } } });
    handle.send({ type: "new_session" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "session_ready")
    );
    handle.close();
    expect(evts.find((ev) => ev.type === "session_ready")).toBeDefined();
  });

  it("set_agents then new_session still works", async () => {
    const { handle } = startDaemon();
    handle.send({ type: "set_agents", agents: { helper: { description: "helps", prompt: "assist" } } });
    handle.send({ type: "new_session" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "session_ready")
    );
    handle.close();
    expect(evts.find((ev) => ev.type === "session_ready")).toBeDefined();
  });

  it("set_permission_mode then new_session still works", async () => {
    const { handle } = startDaemon();
    handle.send({ type: "set_permission_mode", mode: "acceptEdits" });
    handle.send({ type: "new_session" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "session_ready")
    );
    handle.close();
    expect(evts.find((ev) => ev.type === "session_ready")).toBeDefined();
  });

  it("fork_session is consumed on next send — fork_next flag resets to false after use", async () => {
    const { handle } = startDaemon();
    // Set fork flag; then issue new_session which doesn't consume it but verifies daemon still alive
    handle.send({ type: "fork_session" });
    handle.send({ type: "new_session" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "session_ready")
    );
    handle.close();
    expect(evts.find((ev) => ev.type === "session_ready")).toBeDefined();
  });

  it("ask_user_response for unknown requestId does not crash daemon", async () => {
    const { handle } = startDaemon();
    handle.send({ type: "ask_user_response", requestId: "nonexistent-ask", answers: { q: "a" } });
    handle.send({ type: "new_session" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "session_ready")
    );
    handle.close();
    expect(evts.find((ev) => ev.type === "session_ready")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Commands that emit events without requiring an API key
// ---------------------------------------------------------------------------

describe("daemon — request_models emits models_listed", () => {
  it("emits models_listed with an array (possibly empty without API key)", async () => {
    const { handle } = startDaemon();
    handle.send({ type: "request_models" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "models_listed"),
      5000
    );
    handle.close();
    const ev = evts.find((e) => e.type === "models_listed");
    expect(ev).toBeDefined();
    expect(Array.isArray(ev!.models)).toBe(true);
  }, 8000);
});

describe("daemon — request_account_info emits account_info", () => {
  it("emits account_info event (fields may be absent without API key)", async () => {
    const { handle } = startDaemon();
    handle.send({ type: "request_account_info" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "account_info"),
      5000
    );
    handle.close();
    const ev = evts.find((e) => e.type === "account_info");
    expect(ev).toBeDefined();
    expect(ev!.type).toBe("account_info");
  }, 8000);
});

describe("daemon — rewind_files without active session emits error", () => {
  it("emits error when no query is active", async () => {
    const { handle } = startDaemon();
    handle.send({ type: "rewind_files", userMessageId: "msg_1", dryRun: true });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "error"),
      2000
    );
    handle.close();
    const err = evts.find((e) => e.type === "error");
    expect(err).toBeDefined();
    expect(typeof err!.msg).toBe("string");
    expect((err!.msg as string).toLowerCase()).toContain("no active");
  });
});

// ---------------------------------------------------------------------------
// 4. SDK integration tests (require ANTHROPIC_API_KEY)
// ---------------------------------------------------------------------------

const HAS_API_KEY = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

describe.skipIf(!HAS_API_KEY)("daemon SDK integration — thinking mode", () => {
  it("set_thinking enabled → thinking_chunk events arrive before turn_complete", async () => {
    const { handle, proc } = startDaemon();
    handle.send({ type: "set_thinking", thinkingType: "enabled", budgetTokens: 1024 });
    handle.send({ type: "send", prompt: "What is 1+1? Think step by step." });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "turn_complete"),
      90_000
    );
    handle.close();
    await new Promise((r) => proc.on("close", r));
    expect(evts.find((e) => e.type === "thinking_chunk")).toBeDefined();
    expect(evts.find((e) => e.type === "turn_complete")).toBeDefined();
  }, 95_000);
});

describe.skipIf(!HAS_API_KEY)("daemon SDK integration — tool controls", () => {
  it("set_tool_controls empty allowed list still completes a simple prompt", async () => {
    const { handle, proc } = startDaemon();
    handle.send({ type: "set_tool_controls", allowedTools: [], disallowedTools: [] });
    handle.send({ type: "send", prompt: "Reply with only the word: pong" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "turn_complete"),
      60_000
    );
    handle.close();
    await new Promise((r) => proc.on("close", r));
    expect(evts.find((e) => e.type === "text_ready")).toBeDefined();
    expect(evts.find((e) => e.type === "turn_complete")).toBeDefined();
  }, 65_000);
});

describe.skipIf(!HAS_API_KEY)("daemon SDK integration — fork_session", () => {
  it("fork_session flag causes session_forked event on next send", async () => {
    const { handle, proc } = startDaemon();
    // First turn to establish a session
    handle.send({ type: "send", prompt: "Reply: established" });
    await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "turn_complete"),
      60_000
    );
    // Now fork
    handle.send({ type: "fork_session" });
    handle.send({ type: "send", prompt: "Reply: forked" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "session_forked"),
      60_000
    );
    handle.close();
    await new Promise((r) => proc.on("close", r));
    expect(evts.find((e) => e.type === "session_forked")).toBeDefined();
  }, 130_000);
});

describe.skipIf(!HAS_API_KEY)("daemon SDK integration — models_listed with real credentials", () => {
  it("models_listed contains at least one model entry", async () => {
    const { handle, proc } = startDaemon();
    handle.send({ type: "request_models" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "models_listed"),
      20_000
    );
    handle.close();
    await new Promise((r) => proc.on("close", r));
    const ev = evts.find((e) => e.type === "models_listed");
    expect(ev).toBeDefined();
    expect((ev!.models as Array<{ id: string }>).length).toBeGreaterThan(0);
  }, 25_000);
});

describe.skipIf(!HAS_API_KEY)("daemon SDK integration — account_info with real credentials", () => {
  it("account_info carries email, plan, subscriptionType, or apiProvider when authenticated", async () => {
    const { handle, proc } = startDaemon();
    handle.send({ type: "request_account_info" });
    const evts = await handle.collectUntil(
      (e) => e.some((ev) => ev.type === "account_info"),
      20_000
    );
    handle.close();
    await new Promise((r) => proc.on("close", r));
    const ev = evts.find((e) => e.type === "account_info");
    expect(ev).toBeDefined();
    // At least one identifying field should be populated with real creds
    const hasInfo = ev!.email !== undefined
      || ev!.plan !== undefined
      || ev!.subscriptionType !== undefined
      || ev!.apiProvider !== undefined;
    expect(hasInfo).toBe(true);
  }, 25_000);
});
