import { describe, expect, it, beforeAll } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { listSessions, loadSessionHistory, renameSession, countUserTurns } from "../src/session-history.js";

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

  it("returns session with custom name even when .jsonl has no user content", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-named-no-content-"));
    const cwd = "/named/no/content";
    const sessionId = "brand-new-session";
    const projectDir = join(home, ".claude", "projects", cwd.replace(/\//g, "-"));
    await mkdir(projectDir, { recursive: true });
    // Write only a .name sidecar (no .jsonl yet — user renamed before sending first message)
    await writeFile(join(projectDir, `${sessionId}.name`), JSON.stringify({
      name: "My Custom Session",
      updatedAt: "2026-05-11T00:00:00.000Z",
    }));

    const sessions = await listSessions(cwd, home);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].name).toBe("My Custom Session");
    expect(sessions[0].preview).toBe("(new session)");
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

describe("renameSession", () => {
  it("creates a .name sidecar file", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-rename-"));
    const cwd = "/rename/test";
    const sessionId = "sess-abc";
    const dir = join(home, ".claude", "projects", "-rename-test");
    await mkdir(dir, { recursive: true });

    await renameSession(cwd, sessionId, "My Chat", home);

    const raw = await readFile(join(dir, `${sessionId}.name`), "utf8");
    const meta = JSON.parse(raw);
    expect(meta.name).toBe("My Chat");
    expect(typeof meta.updatedAt).toBe("string");
  });

  it("overwrites an existing .name sidecar file", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-rename-"));
    const cwd = "/rename/test";
    const sessionId = "sess-xyz";
    const dir = join(home, ".claude", "projects", "-rename-test");
    await mkdir(dir, { recursive: true });

    await renameSession(cwd, sessionId, "First name", home);
    await renameSession(cwd, sessionId, "Updated name", home);

    const raw = await readFile(join(dir, `${sessionId}.name`), "utf8");
    const meta = JSON.parse(raw);
    expect(meta.name).toBe("Updated name");
  });
});

describe("listSessions — name sidecar", () => {
  it("includes name from .name sidecar when present", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-name-"));
    const cwd = "/name/test";
    const dir = join(home, ".claude", "projects", "-name-test");
    await mkdir(dir, { recursive: true });
    const sessionId = "sess-named";
    await writeFile(
      join(dir, `${sessionId}.jsonl`),
      JSON.stringify({ type: "user", timestamp: "2026-05-01T00:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "Hello" }] } })
    );
    await writeFile(
      join(dir, `${sessionId}.name`),
      JSON.stringify({ name: "My Session", updatedAt: "2026-05-01T00:00:00.000Z" })
    );

    const sessions = await listSessions(cwd, home);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].name).toBe("My Session");
  });

  it("has no name field when .name sidecar is absent", async () => {
    // TMP/CWD fixture from beforeAll has abc123.jsonl with no .name file
    const sessions = await listSessions(CWD, TMP);
    const session = sessions.find(s => s.id === "abc123");
    expect(session).toBeDefined();
    expect(session!.name).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// countUserTurns
// ---------------------------------------------------------------------------

describe("countUserTurns", () => {
  it("returns the number of user turns in a session", async () => {
    // The beforeAll fixture wrote abc123.jsonl with one user turn and one assistant turn
    const count = await countUserTurns(CWD, "abc123", TMP);
    expect(count).toBe(1);
  });

  it("returns 0 for a nonexistent session", async () => {
    const count = await countUserTurns(CWD, "no-such-session", TMP);
    expect(count).toBe(0);
  });

  it("counts multiple user turns correctly", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-count-turns-"));
    const cwd = "/count/project";
    const dir = join(home, ".claude", "projects", "-count-project");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "multi.jsonl"),
      [
        JSON.stringify({ type: "user", timestamp: "2026-05-01T10:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "Turn one" }] } }),
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Answer one" }] } }),
        JSON.stringify({ type: "user", timestamp: "2026-05-01T10:01:00.000Z", message: { role: "user", content: [{ type: "text", text: "Turn two" }] } }),
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Answer two" }] } }),
        JSON.stringify({ type: "user", timestamp: "2026-05-01T10:02:00.000Z", message: { role: "user", content: [{ type: "text", text: "Turn three" }] } }),
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Answer three" }] } }),
      ].join("\n")
    );

    const count = await countUserTurns(cwd, "multi", home);
    expect(count).toBe(3);
  });

  it("does not count tool_result entries as user turns", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-count-tool-"));
    const cwd = "/tool/project";
    const dir = join(home, ".claude", "projects", "-tool-project");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "toolsess.jsonl"),
      [
        JSON.stringify({ type: "user", timestamp: "2026-05-01T10:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "Real turn" }] } }),
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "reply" }] } }),
        // tool_result entry — should be skipped
        JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ignored" }] } }),
      ].join("\n")
    );

    const count = await countUserTurns(cwd, "toolsess", home);
    expect(count).toBe(1);
  });
});
