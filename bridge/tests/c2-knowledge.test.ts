import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  archiveSession,
  deleteSession,
  exportSession,
  listSessions,
  renameSession,
  searchSessions,
  tagSession,
  updateSessionMeta,
} from "../src/session-history.js";

function claudeProjectDir(home: string, cwd: string): string {
  return join(home, ".claude", "projects", cwd.replace(/\//g, "-"));
}

async function makeHome(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeJsonlSession(
  home: string,
  cwd: string,
  sessionId: string,
  lines = [
    JSON.stringify({ type: "user", timestamp: "2026-05-01T10:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "Alpha user prompt" }] } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Beta assistant answer" }] } }),
  ],
): Promise<string> {
  const dir = claudeProjectDir(home, cwd);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${sessionId}.jsonl`), lines.join("\n"));
  return dir;
}

async function readMeta(home: string, cwd: string, sessionId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(claudeProjectDir(home, cwd), `${sessionId}.meta`), "utf8")) as Record<string, unknown>;
}

describe("updateSessionMeta", () => {
  it("happy path: reads existing .meta, merges updates, writes back", async () => {
    const home = await makeHome("claudian-c2-meta-merge-");
    const cwd = "/meta/merge";
    const sessionId = "sess-meta";
    const dir = claudeProjectDir(home, cwd);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${sessionId}.meta`), JSON.stringify({ tags: ["a"], exportedAt: "2026-05-01T00:00:00.000Z" }));

    await updateSessionMeta(cwd, sessionId, { archived: true }, home);

    expect(await readMeta(home, cwd, sessionId)).toEqual({
      tags: ["a"],
      exportedAt: "2026-05-01T00:00:00.000Z",
      archived: true,
    });
  });

  it("no .meta exists: creates new .meta with provided fields only", async () => {
    const home = await makeHome("claudian-c2-meta-new-");
    const cwd = "/meta/new";
    const sessionId = "sess-meta-new";

    await updateSessionMeta(cwd, sessionId, { tags: ["one"] }, home);

    expect(await readMeta(home, cwd, sessionId)).toEqual({ tags: ["one"] });
  });

  it("corrupt .meta: silently overwrites", async () => {
    const home = await makeHome("claudian-c2-meta-corrupt-");
    const cwd = "/meta/corrupt";
    const sessionId = "sess-meta-corrupt";
    const dir = claudeProjectDir(home, cwd);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${sessionId}.meta`), "not json");

    await updateSessionMeta(cwd, sessionId, { archived: false }, home);

    expect(await readMeta(home, cwd, sessionId)).toEqual({ archived: false });
  });
});

describe("tagSession", () => {
  it("sets tags array in .meta", async () => {
    const home = await makeHome("claudian-c2-tag-");
    const cwd = "/tag/test";
    const sessionId = "tag-session";

    await tagSession(cwd, sessionId, ["work", "qt"], home);

    expect(await readMeta(home, cwd, sessionId)).toEqual({ tags: ["work", "qt"] });
  });

  it("tags survive a subsequent renameSession", async () => {
    const home = await makeHome("claudian-c2-tag-rename-");
    const cwd = "/tag/rename";
    const sessionId = "tag-rename-session";
    await tagSession(cwd, sessionId, ["keep"], home);

    await renameSession(cwd, sessionId, "Renamed", home);

    expect((await readMeta(home, cwd, sessionId)).tags).toEqual(["keep"]);
    const nameMeta = JSON.parse(await readFile(join(claudeProjectDir(home, cwd), `${sessionId}.name`), "utf8"));
    expect(nameMeta.name).toBe("Renamed");
  });
});

describe("archiveSession", () => {
  it("archived=true written to .meta", async () => {
    const home = await makeHome("claudian-c2-archive-true-");
    const cwd = "/archive/true";
    await archiveSession(cwd, "archive-session", true, home);
    expect(await readMeta(home, cwd, "archive-session")).toEqual({ archived: true });
  });

  it("archived=false written to .meta", async () => {
    const home = await makeHome("claudian-c2-archive-false-");
    const cwd = "/archive/false";
    await archiveSession(cwd, "archive-session", false, home);
    expect(await readMeta(home, cwd, "archive-session")).toEqual({ archived: false });
  });
});

describe("deleteSession — sidecar cleanup", () => {
  it("deletes both .jsonl and .meta", async () => {
    const home = await makeHome("claudian-c2-delete-");
    const cwd = "/delete/test";
    const sessionId = "delete-session";
    const dir = await writeJsonlSession(home, cwd, sessionId);
    await writeFile(join(dir, `${sessionId}.meta`), JSON.stringify({ archived: true }));

    await deleteSession(cwd, sessionId, home);

    await expect(stat(join(dir, `${sessionId}.jsonl`))).rejects.toThrow();
    await expect(stat(join(dir, `${sessionId}.meta`))).rejects.toThrow();
  });

  it("missing .meta succeeds gracefully", async () => {
    const home = await makeHome("claudian-c2-delete-missing-meta-");
    const cwd = "/delete/missing";
    const sessionId = "delete-missing-meta";
    await writeJsonlSession(home, cwd, sessionId);

    await expect(deleteSession(cwd, sessionId, home)).resolves.toBeUndefined();
  });
});

describe("searchSessions", () => {
  it("finds match in user turn, returns sessionId + positive hitCount + non-empty excerpt", async () => {
    const home = await makeHome("claudian-c2-search-user-");
    const cwd = "/search/user";
    await writeJsonlSession(home, cwd, "user-match", [
      JSON.stringify({ type: "user", timestamp: "2026-05-01T10:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "Find the sapphire marker" }] } }),
    ]);

    const results = await searchSessions(cwd, "sapphire", home);

    expect(results[0].sessionId).toBe("user-match");
    expect(results[0].hitCount).toBeGreaterThan(0);
    expect(results[0].excerpt.length).toBeGreaterThan(0);
  });

  it("finds match in assistant turn", async () => {
    const home = await makeHome("claudian-c2-search-assistant-");
    const cwd = "/search/assistant";
    await writeJsonlSession(home, cwd, "assistant-match", [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "The answer mentions citrine." }] } }),
    ]);

    const results = await searchSessions(cwd, "citrine", home);

    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe("assistant-match");
  });

  it("case-insensitive match", async () => {
    const home = await makeHome("claudian-c2-search-case-");
    const cwd = "/search/case";
    await writeJsonlSession(home, cwd, "case-match", [
      JSON.stringify({ type: "user", timestamp: "2026-05-01T10:00:00.000Z", message: { role: "user", content: "MixedCase Needle" } }),
    ]);

    const results = await searchSessions(cwd, "needle", home);

    expect(results[0].sessionId).toBe("case-match");
  });

  it("no matches returns empty array", async () => {
    const home = await makeHome("claudian-c2-search-none-");
    const cwd = "/search/none";
    await writeJsonlSession(home, cwd, "no-match");

    expect(await searchSessions(cwd, "not-present", home)).toEqual([]);
  });

  it("empty query returns empty array", async () => {
    const home = await makeHome("claudian-c2-search-empty-");
    expect(await searchSessions("/search/empty", "", home)).toEqual([]);
  });

  it("session with no JSONL skipped", async () => {
    const home = await makeHome("claudian-c2-search-orphan-");
    const cwd = "/search/orphan";
    const dir = claudeProjectDir(home, cwd);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "orphan.name"), JSON.stringify({ name: "Mentions sapphire" }));

    expect(await searchSessions(cwd, "sapphire", home)).toEqual([]);
  });
});

describe("exportSession — exportedAt tracking", () => {
  it("exportedAt written to .meta after successful export", async () => {
    const home = await makeHome("claudian-c2-export-meta-");
    const cwd = "/export/meta";
    const sessionId = "export-meta-session";
    await writeJsonlSession(home, cwd, sessionId);

    await exportSession(cwd, sessionId, "clean_summary", join(home, "export.md"), home);

    expect(typeof (await readMeta(home, cwd, sessionId)).exportedAt).toBe("string");
  });

  it("exportedAt present in subsequent listSessions result", async () => {
    const home = await makeHome("claudian-c2-export-list-");
    const cwd = "/export/list";
    const sessionId = "export-list-session";
    await writeJsonlSession(home, cwd, sessionId);

    await exportSession(cwd, sessionId, "clean_summary", join(home, "export.md"), home);

    const session = (await listSessions(cwd, home)).find(s => s.id === sessionId);
    expect(session?.exportedAt).toBeDefined();
  });
});

describe("listSessions — extended fields", () => {
  it("returns tags when present in .meta", async () => {
    const home = await makeHome("claudian-c2-list-tags-");
    const cwd = "/list/tags";
    const sessionId = "list-tags-session";
    await writeJsonlSession(home, cwd, sessionId);
    await tagSession(cwd, sessionId, ["one", "two"], home);

    expect((await listSessions(cwd, home))[0].tags).toEqual(["one", "two"]);
  });

  it("returns archived when present in .meta", async () => {
    const home = await makeHome("claudian-c2-list-archived-");
    const cwd = "/list/archived";
    const sessionId = "list-archived-session";
    await writeJsonlSession(home, cwd, sessionId);
    await archiveSession(cwd, sessionId, true, home);

    expect((await listSessions(cwd, home))[0].archived).toBe(true);
  });

  it("returns exportedAt when present in .meta", async () => {
    const home = await makeHome("claudian-c2-list-exported-");
    const cwd = "/list/exported";
    const sessionId = "list-exported-session";
    await writeJsonlSession(home, cwd, sessionId);
    await updateSessionMeta(cwd, sessionId, { exportedAt: "2026-05-01T00:00:00.000Z" }, home);

    expect((await listSessions(cwd, home))[0].exportedAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("fields absent from .meta are undefined in SessionEntry", async () => {
    const home = await makeHome("claudian-c2-list-undefined-");
    const cwd = "/list/undefined";
    await writeJsonlSession(home, cwd, "list-undefined-session");

    const session = (await listSessions(cwd, home))[0];
    expect(session.tags).toBeUndefined();
    expect(session.archived).toBeUndefined();
    expect(session.exportedAt).toBeUndefined();
  });

  it("orphan path (.name present, no .jsonl) also returns tags from .meta", async () => {
    const home = await makeHome("claudian-c2-list-orphan-");
    const cwd = "/list/orphan";
    const sessionId = "list-orphan-session";
    const dir = claudeProjectDir(home, cwd);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${sessionId}.name`), JSON.stringify({ name: "Orphan Session" }));
    await tagSession(cwd, sessionId, ["orphan"], home);

    const session = (await listSessions(cwd, home)).find(s => s.id === sessionId);
    expect(session?.tags).toEqual(["orphan"]);
  });
});
