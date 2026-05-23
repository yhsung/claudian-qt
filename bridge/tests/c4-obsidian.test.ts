import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "fs/promises";
import { basename, join } from "path";
import { tmpdir } from "os";
import {
  exportSession,
  getExportedSiblingStems,
  listSessions,
  updateSessionMeta,
} from "../src/session-history.js";

function claudeProjectDir(home: string, cwd: string): string {
  return join(home, ".claude", "projects", cwd.replace(/\//g, "-"));
}

async function makeHome(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeSession(
  home: string,
  cwd: string,
  sessionId: string,
  userText = "Implement Obsidian export",
  assistantText = "Added Obsidian export plumbing.",
  timestamp = "2026-05-01T10:00:00.000Z",
): Promise<string> {
  const dir = claudeProjectDir(home, cwd);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${sessionId}.jsonl`), [
    JSON.stringify({ type: "user", timestamp, message: { role: "user", content: [{ type: "text", text: userText }] } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: assistantText }] } }),
  ].join("\n"));
  return dir;
}

async function readMeta(home: string, cwd: string, sessionId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(claudeProjectDir(home, cwd), `${sessionId}.meta`), "utf8")) as Record<string, unknown>;
}

function markdownBody(md: string): string {
  const end = md.indexOf("\n---\n");
  return end === -1 ? md : md.slice(end + "\n---\n".length);
}

describe("getExportedSiblingStems", () => {
  it("returns empty array when no sessions have been exported", async () => {
    const home = await makeHome("claudian-c4-siblings-none-");
    const cwd = "/c4/siblings/none";
    await writeSession(home, cwd, "c4-sibling-a");
    await writeSession(home, cwd, "c4-sibling-b");

    expect(await getExportedSiblingStems(cwd, "c4-sibling-a", home)).toEqual([]);
  });

  it("returns stems of previously-exported siblings", async () => {
    const home = await makeHome("claudian-c4-siblings-exported-");
    const cwd = "/c4/siblings/exported";
    await writeSession(home, cwd, "c4-current");
    await writeSession(home, cwd, "c4-old");
    await writeSession(home, cwd, "c4-new");
    await updateSessionMeta(cwd, "c4-old", { exportedAt: "2026-05-01T10:00:00.000Z", exportedStem: "old-export" }, home);
    await updateSessionMeta(cwd, "c4-new", { exportedAt: "2026-05-03T10:00:00.000Z", exportedStem: "new-export" }, home);

    expect(await getExportedSiblingStems(cwd, "c4-current", home)).toEqual(["new-export", "old-export"]);
  });

  it("excludes the current sessionId from the result", async () => {
    const home = await makeHome("claudian-c4-siblings-exclude-");
    const cwd = "/c4/siblings/exclude";
    await writeSession(home, cwd, "c4-current");
    await writeSession(home, cwd, "c4-sibling");
    await updateSessionMeta(cwd, "c4-current", { exportedAt: "2026-05-04T10:00:00.000Z", exportedStem: "current-export" }, home);
    await updateSessionMeta(cwd, "c4-sibling", { exportedAt: "2026-05-03T10:00:00.000Z", exportedStem: "sibling-export" }, home);

    expect(await getExportedSiblingStems(cwd, "c4-current", home)).toEqual(["sibling-export"]);
  });
});

describe("exportSession backlinks", () => {
  it("includes related: YAML key when relatedStems is non-empty", async () => {
    const home = await makeHome("claudian-c4-related-present-");
    const cwd = "/c4/related/present";
    const sessionId = "c4-related-present-session";
    await writeSession(home, cwd, sessionId);

    const finalPath = await exportSession(cwd, sessionId, "clean_summary", join(home, "clean.md"), home, undefined, ["alpha", "needs:quotes"]);
    const md = await readFile(finalPath, "utf8");

    expect(md).toContain("related:\n  - alpha\n  - \"needs:quotes\"");
  });

  it("omits related: key when relatedStems is empty", async () => {
    const home = await makeHome("claudian-c4-related-empty-");
    const cwd = "/c4/related/empty";
    const sessionId = "c4-related-empty-session";
    await writeSession(home, cwd, sessionId);

    const finalPath = await exportSession(cwd, sessionId, "clean_summary", join(home, "clean.md"), home, undefined, []);
    const md = await readFile(finalPath, "utf8");

    expect(md).not.toContain("related:");
  });
});

describe("exportSession template system", () => {
  it("substitutes template tokens with session content", async () => {
    const home = await makeHome("claudian-c4-template-substitute-");
    const cwd = "/c4/template/substitute";
    const sessionId = "c4-template-substitute-session";
    await writeSession(home, cwd, sessionId, "First prompt", "First response");

    const finalPath = await exportSession(
      cwd,
      sessionId,
      "clean_summary",
      join(home, "template.md"),
      home,
      undefined,
      ["related-note"],
      "# {{title}}\n\nAt {{date}}\n\nCWD: {{cwd}}\n\nPrompts:\n{{prompts}}\n\nResponses:\n{{responses}}\n\nTools:\n{{tools}}\n",
    );
    const md = await readFile(finalPath, "utf8");

    expect(md).toContain("related:\n  - related-note");
    expect(md).toContain("# c4-templ");
    expect(md).toContain(`CWD: ${cwd}`);
    expect(md).toContain("Prompts:\n- First prompt");
    expect(md).toContain("Responses:\nFirst response");
    expect(md).toContain("Tools:\n");
  });

  it("does not re-substitute tokens inside session content (one-pass)", async () => {
    const home = await makeHome("claudian-c4-template-one-pass-");
    const cwd = "/c4/template/one-pass";
    const sessionId = "c4-template-one-pass-session";
    await writeSession(home, cwd, sessionId, "Keep literal {{cwd}} token", "Assistant kept {{cwd}} literal");

    const finalPath = await exportSession(
      cwd,
      sessionId,
      "clean_summary",
      join(home, "template.md"),
      home,
      undefined,
      undefined,
      "Prompts:\n{{prompts}}\n\nResponses:\n{{responses}}\n",
    );
    const md = await readFile(finalPath, "utf8");
    const body = markdownBody(md);

    expect(body).toContain("- Keep literal {{cwd}} token");
    expect(body).toContain("Assistant kept {{cwd}} literal");
    expect(body).not.toContain(cwd);
  });

  it("falls back to clean_summary when templateContent is empty", async () => {
    const home = await makeHome("claudian-c4-template-empty-");
    const cwd = "/c4/template/empty";
    const sessionId = "c4-template-empty-session";
    await writeSession(home, cwd, sessionId, "Fallback prompt", "Fallback response");

    const finalPath = await exportSession(cwd, sessionId, "clean_summary", join(home, "clean.md"), home, undefined, undefined, "   ");
    const md = await readFile(finalPath, "utf8");

    expect(md).toContain("## User\n\nFallback prompt");
    expect(md).toContain("## Claude\n\nFallback response");
  });
});

describe("exportSession metadata persistence", () => {
  it("stores exportedStem in .meta after writing the file", async () => {
    const home = await makeHome("claudian-c4-meta-stem-");
    const cwd = "/c4/meta/stem";
    const sessionId = "c4-meta-stem-session";
    await writeSession(home, cwd, sessionId);

    const finalPath = await exportSession(cwd, sessionId, "clean_summary", join(home, "clean.md"), home);
    const meta = await readMeta(home, cwd, sessionId);
    const session = (await listSessions(cwd, home)).find((s) => s.id === sessionId);

    expect(meta.exportedStem).toBe(basename(finalPath, ".md"));
    expect(session?.exportedStem).toBe(basename(finalPath, ".md"));
  });
});
