import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { exportSession, renameSession } from "../src/session-history.js";

function claudeProjectDir(home: string, cwd: string): string {
  return join(home, ".claude", "projects", cwd.replace(/\//g, "-"));
}

async function writeSession(home: string, cwd: string, sessionId: string): Promise<void> {
  const dir = claudeProjectDir(home, cwd);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${sessionId}.jsonl`), [
    JSON.stringify({ type: "user", timestamp: "2026-05-01T10:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "Implement export" }] } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Added export support." }] } }),
  ].join("\n"));
}

describe("exportSession", () => {
  it("writes Clean Summary markdown with user and Claude headers", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-export-clean-"));
    const cwd = "/export/clean";
    const sessionId = "clean-session";
    await writeSession(home, cwd, sessionId);

    const targetPath = join(home, "clean.md");
    const finalPath = await exportSession(cwd, sessionId, "clean_summary", targetPath, home);
    const md = await readFile(finalPath, "utf8");

    expect(md).toContain("## User");
    expect(md).toContain("## Claude");
  });

  it("writes PR Notes markdown with expected sections", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-export-pr-"));
    const cwd = "/export/pr";
    const sessionId = "pr-session";
    await writeSession(home, cwd, sessionId);

    const targetPath = join(home, "pr.md");
    const finalPath = await exportSession(cwd, sessionId, "pr_notes", targetPath, home);
    const md = await readFile(finalPath, "utf8");

    expect(md).toContain("## What");
    expect(md).toContain("## How");
    expect(md).toContain("## Testing");
  });

  it("throws for an empty session", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-export-empty-"));
    await expect(exportSession("/export/empty", "missing-session", "clean_summary", join(home, "empty.md"), home))
      .rejects.toThrow("Session has no content to export");
  });

  it("uses an exclusive-create suffix when names collide", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-export-collision-"));
    const cwd = "/export/collision";
    const sessionId = "collision-session";
    await writeSession(home, cwd, sessionId);
    await writeFile(join(home, "name.md"), "existing");
    await writeFile(join(home, "name (1).md"), "existing");

    const finalPath = await exportSession(cwd, sessionId, "clean_summary", join(home, "name.md"), home);

    expect(finalPath).toBe(join(home, "name (2).md"));
    const md = await readFile(finalPath, "utf8");
    expect(md).toContain("## User");
  });
});

describe("renameSession", () => {
  it("preserves existing sidecar fields when renaming", async () => {
    const home = await mkdtemp(join(tmpdir(), "claudian-export-rename-"));
    const cwd = "/export/rename";
    const sessionId = "rename-session";
    const dir = claudeProjectDir(home, cwd);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${sessionId}.name`), JSON.stringify({
      name: "Old name",
      updatedAt: "2026-05-01T00:00:00.000Z",
      tags: ["a"],
    }));

    await renameSession(cwd, sessionId, "New name", home);

    const meta = JSON.parse(await readFile(join(dir, `${sessionId}.name`), "utf8"));
    expect(meta.name).toBe("New name");
    expect(meta.tags).toEqual(["a"]);
    expect(typeof meta.updatedAt).toBe("string");
  });
});
