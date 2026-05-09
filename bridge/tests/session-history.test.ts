import { describe, it, expect, beforeAll } from "vitest";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { listSessions, loadSessionHistory } from "../src/session-history.js";

const TMP = join(tmpdir(), "claudian-test-" + process.pid);
const CWD = "/test/project";

function claudeProjectDir(cwd: string): string {
  return join(TMP, ".claude", "projects", cwd.replace(/\//g, "-"));
}

beforeAll(async () => {
  const dir = claudeProjectDir(CWD);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "abc123.jsonl"),
    [
      JSON.stringify({ type: "user", timestamp: "2026-05-09T10:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "What is 2+2?" }] } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "2 + 2 = 4." }] } }),
      JSON.stringify({ type: "user", timestamp: "2026-05-09T10:01:00.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ignored" }] } }),
    ].join("\n")
  );
});

describe("listSessions", () => {
  it("returns sessions for a known cwd", async () => {
    const sessions = await listSessions(CWD, TMP);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("abc123");
    expect(sessions[0].preview).toBe("What is 2+2?");
    expect(sessions[0].timestamp).toBe("2026-05-09T10:00:00.000Z");
  });

  it("returns empty array for unknown cwd", async () => {
    const sessions = await listSessions("/no/such/path", TMP);
    expect(sessions).toEqual([]);
  });
});

describe("loadSessionHistory", () => {
  it("returns user and assistant turns, skipping tool_result", async () => {
    const turns = await loadSessionHistory(CWD, "abc123", TMP);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ role: "user", text: "What is 2+2?" });
    expect(turns[1]).toEqual({ role: "assistant", text: "2 + 2 = 4." });
  });

  it("returns empty array for unknown session", async () => {
    const turns = await loadSessionHistory(CWD, "nonexistent", TMP);
    expect(turns).toEqual([]);
  });
});
