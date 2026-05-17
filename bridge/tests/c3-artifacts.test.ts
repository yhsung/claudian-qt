import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildFrontmatter,
  exportSession,
  listSessions,
  truncateForPrompt,
  updateSessionMeta,
} from "../src/session-history.js";
import type { HistoryTurn } from "../src/protocol.js";

function claudeProjectDir(home: string, cwd: string): string {
  return join(home, ".claude", "projects", cwd.replace(/\//g, "-"));
}

async function makeHome(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeSession(home: string, cwd: string, sessionId: string): Promise<string> {
  const dir = claudeProjectDir(home, cwd);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${sessionId}.jsonl`), [
    JSON.stringify({ type: "user", timestamp: "2026-05-01T10:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "Implement artifact export" }] } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Added export plumbing and tests." }] } }),
  ].join("\n"));
  return dir;
}

async function readMeta(home: string, cwd: string, sessionId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(claudeProjectDir(home, cwd), `${sessionId}.meta`), "utf8")) as Record<string, unknown>;
}

function turn(role: "user" | "assistant", text: string): HistoryTurn {
  return { role, text, attachments: [] };
}

describe("buildFrontmatter", () => {
  it("serializes basic string fields as YAML key-value pairs", () => {
    const yaml = buildFrontmatter({ title: "Session", date: "2026-05-01" });

    expect(yaml).toContain("title: Session");
    expect(yaml).toContain("date: 2026-05-01");
  });

  it("serializes array fields as YAML lists", () => {
    const yaml = buildFrontmatter({ tags: ["qt", "export"] });

    expect(yaml).toContain("tags:\n  - qt\n  - export");
  });

  it("omits undefined fields", () => {
    const yaml = buildFrontmatter({ title: "Session", summary: undefined });

    expect(yaml).toContain("title: Session");
    expect(yaml).not.toContain("summary:");
  });

  it("starts and ends with YAML delimiters", () => {
    const yaml = buildFrontmatter({ title: "Session" });

    expect(yaml.startsWith("---\n")).toBe(true);
    expect(yaml.endsWith("---\n")).toBe(true);
  });
});

describe("truncateForPrompt", () => {
  it("returns a short session verbatim without a truncation note", () => {
    const text = truncateForPrompt([
      turn("user", "Do the work"),
      turn("assistant", "Done"),
    ]);

    expect(text).toBe("## User\n\nDo the work\n\n## Claude\n\nDone\n\n");
    expect(text).not.toContain("session truncated");
  });

  it("truncates long sessions at a turn boundary", () => {
    const text = truncateForPrompt([
      turn("user", "old turn that should be dropped"),
      turn("assistant", "recent answer"),
    ], 30);

    expect(text.startsWith("[session truncated")).toBe(true);
    expect(text).not.toContain("old turn");
    expect(text).toContain("recent answer");
  });

  it("excludes a single turn larger than maxChars and prepends a truncation note", () => {
    const text = truncateForPrompt([turn("user", "x".repeat(200))], 20);

    expect(text).toBe("[session truncated — showing most recent turns]\n\n");
  });

  it("returns empty string for an empty turn list", () => {
    expect(truncateForPrompt([])).toBe("");
  });
});

describe("exportSession — C3 presets", () => {
  it("clean_summary with tags in .meta includes tags frontmatter list", async () => {
    const home = await makeHome("claudian-c3-export-tags-");
    const cwd = "/c3/export/tags";
    const sessionId = "c3-tags-session";
    await writeSession(home, cwd, sessionId);
    await updateSessionMeta(cwd, sessionId, { tags: ["work", "qt"] }, home);

    const finalPath = await exportSession(cwd, sessionId, "clean_summary", join(home, "clean.md"), home);
    const md = await readFile(finalPath, "utf8");

    expect(md).toContain("tags:\n  - work\n  - qt");
  });

  it("clean_summary with summary in .meta includes summary frontmatter field", async () => {
    const home = await makeHome("claudian-c3-export-summary-");
    const cwd = "/c3/export/summary";
    const sessionId = "c3-summary-session";
    await writeSession(home, cwd, sessionId);
    await updateSessionMeta(cwd, sessionId, { summary: "Three sentence worklog." }, home);

    const finalPath = await exportSession(cwd, sessionId, "clean_summary", join(home, "clean.md"), home);
    const md = await readFile(finalPath, "utf8");

    expect(md).toContain("summary: Three sentence worklog.");
  });

  it("pr_notes_llm with llmContent writes generated body with frontmatter", async () => {
    const home = await makeHome("claudian-c3-export-pr-llm-");
    const cwd = "/c3/export/pr-llm";
    const sessionId = "c3-pr-llm-session";
    await writeSession(home, cwd, sessionId);

    const finalPath = await exportSession(cwd, sessionId, "pr_notes_llm", join(home, "pr.md"), home, "## What\n\n- Generated notes");
    const md = await readFile(finalPath, "utf8");

    expect(md).toContain("session_id: c3-pr-llm-session");
    expect(md).toContain("## What\n\n- Generated notes");
  });

  it("pr_notes_llm with empty llmContent falls back to template format", async () => {
    const home = await makeHome("claudian-c3-export-pr-empty-");
    const cwd = "/c3/export/pr-empty";
    const sessionId = "c3-pr-empty-session";
    await writeSession(home, cwd, sessionId);

    const finalPath = await exportSession(cwd, sessionId, "pr_notes_llm", join(home, "pr.md"), home, "");
    const md = await readFile(finalPath, "utf8");

    expect(md).toContain("## What");
    expect(md).toContain("## How");
    expect(md).toContain("## Testing");
  });

  it("adr with llmContent includes clean summary and Architecture Decisions section", async () => {
    const home = await makeHome("claudian-c3-export-adr-");
    const cwd = "/c3/export/adr";
    const sessionId = "c3-adr-session";
    await writeSession(home, cwd, sessionId);

    const finalPath = await exportSession(cwd, sessionId, "adr", join(home, "adr.md"), home, "## Status\nAccepted");
    const md = await readFile(finalPath, "utf8");

    expect(md).toContain("## User");
    expect(md).toContain("## Architecture Decisions");
    expect(md).toContain("## Status\nAccepted");
  });
});

describe("listSessions — summary field", () => {
  it("returns summary when present in .meta", async () => {
    const home = await makeHome("claudian-c3-list-summary-");
    const cwd = "/c3/list/summary";
    const sessionId = "c3-list-summary-session";
    await writeSession(home, cwd, sessionId);
    await updateSessionMeta(cwd, sessionId, { summary: "Completed export work." }, home);

    const session = (await listSessions(cwd, home))[0];

    expect(session.summary).toBe("Completed export work.");
  });

  it("leaves summary undefined when absent", async () => {
    const home = await makeHome("claudian-c3-list-no-summary-");
    const cwd = "/c3/list/no-summary";
    await writeSession(home, cwd, "c3-list-no-summary-session");

    const session = (await listSessions(cwd, home))[0];

    expect(session.summary).toBeUndefined();
  });
});

describe("updateSessionMeta — summary", () => {
  it("writes summary to .meta", async () => {
    const home = await makeHome("claudian-c3-meta-summary-");
    const cwd = "/c3/meta/summary";
    const sessionId = "c3-meta-summary-session";

    await updateSessionMeta(cwd, sessionId, { summary: "Summarized work." }, home);

    expect(await readMeta(home, cwd, sessionId)).toEqual({ summary: "Summarized work." });
  });

  it("persists summary alongside existing tags and archived fields", async () => {
    const home = await makeHome("claudian-c3-meta-merge-");
    const cwd = "/c3/meta/merge";
    const sessionId = "c3-meta-merge-session";
    const dir = claudeProjectDir(home, cwd);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${sessionId}.meta`), JSON.stringify({ tags: ["qt"], archived: true }));

    await updateSessionMeta(cwd, sessionId, { summary: "Merged metadata." }, home);

    expect(await readMeta(home, cwd, sessionId)).toEqual({
      tags: ["qt"],
      archived: true,
      summary: "Merged metadata.",
    });
  });
});
