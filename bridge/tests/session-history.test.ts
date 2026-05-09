import { describe, expect, it, beforeAll } from "vitest";
import { mkdtemp, mkdir, writeFile } from "fs/promises";
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
  it("returns user and assistant turns with empty attachments, skipping tool_result", async () => {
    const turns = await loadSessionHistory(CWD, "abc123", TMP);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ role: "user", text: "What is 2+2?", attachments: [] });
    expect(turns[1]).toEqual({ role: "assistant", text: "2 + 2 = 4.", attachments: [] });
  });

  it("returns empty array for unknown session", async () => {
    const turns = await loadSessionHistory(CWD, "nonexistent", TMP);
    expect(turns).toEqual([]);
  });

  it("merges manifest attachments onto user turns by turn index", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-history-home-"));
    const cwd = "/tmp/project";
    const sessionId = "session-1";

    // Create the .claude project dir with a session JSONL
    const projectDir = join(home, ".claude", "projects", "-tmp-project");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, `${sessionId}.jsonl`), [
      JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "look at this" }] } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "done" }] } }),
    ].join("\n") + "\n");

    // Create the attachment manifest
    const attachmentDir = join(home, ".claudian-qt", "attachments", "sessions", sessionId);
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(join(attachmentDir, "manifest.json"), JSON.stringify([
      {
        turnIndex: 0,
        attachments: [{
          id: "att-1",
          originalName: "diagram.png",
          mimeType: "image/png",
          relativePath: "sessions/session-1/turn-0000/00-att-1.png",
          fileUrl: "file:///tmp/fake.png",
          sizeBytes: 8,
          width: 320,
          height: 200,
        }],
      },
    ]));

    const turns = await loadSessionHistory(cwd, sessionId, home);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual(expect.objectContaining({
      role: "user",
      text: "look at this",
      attachments: [expect.objectContaining({ id: "att-1" })],
    }));
    expect(turns[1]).toEqual(expect.objectContaining({
      role: "assistant",
      text: "done",
      attachments: [],
    }));
  });

  it("returns empty array when session file does not exist", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-history-home-missing-"));
    const turns = await loadSessionHistory("/tmp/nonexistent", "no-session", home);
    expect(turns).toEqual([]);
  });
});
