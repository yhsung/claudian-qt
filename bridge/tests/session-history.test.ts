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

describe("listSessions — corrupt orphan .name sidecar", () => {
  it("survives corrupt orphan .name file (readFile fails or JSON parse fails)", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-orphan-corrupt-"));
    const cwd = "/orphan/corrupt/test";
    const dir = join(home, ".claude", "projects", "-orphan-corrupt-test");
    await mkdir(dir, { recursive: true });
    // Write a .name file WITHOUT a matching .jsonl (orphan)
    const orphanId = "orphan-session-1";
    await writeFile(join(dir, `${orphanId}.name`), "not json {{{");

    // Also write a valid orphan to ensure the corrupt one doesn't break the valid one
    const validOrphanId = "orphan-session-2";
    await writeFile(join(dir, `${validOrphanId}.name`), JSON.stringify({
      name: "Valid Orphan",
      updatedAt: "2026-05-01T00:00:00.000Z",
    }));

    const sessions = await listSessions(cwd, home);
    // The valid orphan should appear; corrupt one should be skipped silently
    const valid = sessions.find(s => s.id === validOrphanId);
    expect(valid).toBeDefined();
    expect(valid!.name).toBe("Valid Orphan");
    expect(valid!.preview).toBe("(new session)");
    // Corrupt orphan should not appear (catch block silently skips)
    const corrupt = sessions.find(s => s.id === orphanId);
    expect(corrupt).toBeUndefined();
  });
});

describe("listSessions — corrupt .name sidecar", () => {
  it("does not crash on corrupt (non-JSON) .name sidecar; returns session without name", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-corrupt-name-"));
    const cwd = "/corrupt/name/test";
    const dir = join(home, ".claude", "projects", "-corrupt-name-test");
    await mkdir(dir, { recursive: true });
    const sessionId = "sess-corrupt";
    // Write a valid JSONL with a user turn
    await writeFile(
      join(dir, `${sessionId}.jsonl`),
      JSON.stringify({ type: "user", timestamp: "2026-05-01T00:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "hello" }] } })
    );
    // Write a corrupt .name file
    await writeFile(join(dir, `${sessionId}.name`), "not json {{{");

    const sessions = await listSessions(cwd, home);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(sessionId);
    // Name should be undefined because .name file was corrupt
    expect(sessions[0].name).toBeUndefined();
  });
});

describe("loadSessionHistory — null content on assistant", () => {
  it("handles assistant message with null/undefined content gracefully", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-null-content-"));
    const cwd = "/null/content/test";
    const dir = join(home, ".claude", "projects", "-null-content-test");
    await mkdir(dir, { recursive: true });
    const sessionId = "null-content-sess";
    await writeFile(join(dir, `${sessionId}.jsonl`), [
      JSON.stringify({ type: "user", timestamp: "2026-05-01T00:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "hello" }] } }),
      // Assistant with null content — exercises `content ?? []`
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: null } }),
      // Assistant with no content field at all
      JSON.stringify({ type: "assistant", message: { role: "assistant" } }),
    ].join("\n"));

    const turns = await loadSessionHistory(cwd, sessionId, home);
    expect(turns).toHaveLength(1); // only the user turn; both assistant entries produce empty text
    expect(turns[0]).toEqual({ role: "user", text: "hello", attachments: [] });
  });
});

describe("loadSessionHistory — corrupt JSON lines", () => {
  it("skips unparseable JSON lines and continues reading", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-corrupt-jsonl-"));
    const cwd = "/corrupt/jsonl/test";
    const dir = join(home, ".claude", "projects", "-corrupt-jsonl-test");
    await mkdir(dir, { recursive: true });
    const sessionId = "sess-corrupt-lines";
    await writeFile(join(dir, `${sessionId}.jsonl`), [
      JSON.stringify({ type: "user", timestamp: "2026-05-01T00:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "turn one" }] } }),
      "this is not valid json {{{",
      "",
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "answer one" }] } }),
    ].join("\n"));

    const turns = await loadSessionHistory(cwd, sessionId, home);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ role: "user", text: "turn one", attachments: [] });
    expect(turns[1]).toEqual({ role: "assistant", text: "answer one", attachments: [] });
  });
});

describe("renameSession — creates missing project directory", () => {
  it("creates the project directory tree when it does not exist yet", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-rename-mkdir-"));
    const cwd = "/deeply/nested/new/project";
    const sessionId = "fresh-session";
    // No project directory exists yet

    await renameSession(cwd, sessionId, "New Name", home);

    const expectedDir = join(home, ".claude", "projects", "-deeply-nested-new-project");
    const raw = await readFile(join(expectedDir, `${sessionId}.name`), "utf8");
    const meta = JSON.parse(raw);
    expect(meta.name).toBe("New Name");
  });
});

describe("loadSessionHistory — stream error", () => {
  it("returns empty array when the session file is a directory (cannot be read as stream)", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-stream-err-"));
    const cwd = "/stream/err/test";
    const dir = join(home, ".claude", "projects", "-stream-err-test");
    await mkdir(dir, { recursive: true });
    const sessionId = "dir-instead-of-file";
    // Create a directory where the .jsonl file should be — cannot be read as stream
    const filePath = join(dir, `${sessionId}.jsonl`);
    await mkdir(filePath, { recursive: true });

    const turns = await loadSessionHistory(cwd, sessionId, home);
    expect(turns).toEqual([]);
  });
});

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
