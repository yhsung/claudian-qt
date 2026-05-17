import * as readline from "readline";
import * as fs from "fs";
import { readdir, readFile, writeFile, mkdir, unlink } from "fs/promises";
import { join, dirname, basename } from "path";
import * as os from "os";
import { renameSession as sdkRenameSession } from "@anthropic-ai/claude-agent-sdk";
import { attachmentRoot, loadAttachmentManifest, rehydrateAttachment } from "./attachment-store.js";
import type { HistoryAttachment, HistoryTurn } from "./protocol.js";

export interface SessionEntry {
  id: string;
  preview: string;
  timestamp: string;
  name?: string;
}

// Legacy alias kept for backward compatibility within this file
type TurnEntry = HistoryTurn;

function claudeProjectDir(cwd: string, home = os.homedir()): string {
  return join(home, ".claude", "projects", cwd.replace(/\//g, "-"));
}

/** List sessions from JSONL files directly (used as fallback or in test mode). */
async function listSessionsFromFiles(
  cwd: string,
  home: string,
): Promise<SessionEntry[]> {
  const dir = claudeProjectDir(cwd, home);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
  // Sessions with .name but no .jsonl (brand-new sessions renamed before first message)
  const orphanNames = new Set(
    files
      .filter((f) => f.endsWith(".name") && !files.includes(f.slice(0, -5) + ".jsonl"))
      .map((f) => f.slice(0, -5))
  );

  const sessions: SessionEntry[] = [];

  for (const filename of jsonlFiles) {
    const sessionId = filename.slice(0, -6);
    let preview = "";
    let timestamp = "";

    const rl = readline.createInterface({
      input: fs.createReadStream(join(dir, filename)),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      let obj: Record<string, unknown>;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type !== "user") continue;

      timestamp = (obj.timestamp as string) ?? "";
      const content = (obj.message as Record<string, unknown>).content;
      if (typeof content === "string") {
        preview = content.slice(0, 120);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as Record<string, unknown>;
          if (b.type === "text") { preview = (b.text as string).slice(0, 120); break; }
        }
      }
      break;
    }
    rl.close();

    if (preview) {
      const entry: SessionEntry = { id: sessionId, preview, timestamp };
      try {
        const metaRaw = await readFile(join(dir, filename.replace(".jsonl", ".name")), "utf8");
        const meta = JSON.parse(metaRaw);
        entry.name = meta.name || undefined;
      } catch {
        // no .name file — session has no custom name
      }
      sessions.push(entry);
    }
  }

  // Add orphan .name files (brand-new sessions renamed before first message)
  for (const sessionId of orphanNames) {
    try {
      const metaRaw = await readFile(join(dir, `${sessionId}.name`), "utf8");
      const meta = JSON.parse(metaRaw);
      if (meta.name) {
        sessions.push({
          id: sessionId,
          preview: "(new session)",
          timestamp: new Date().toISOString(),
          name: meta.name,
        });
      }
    } catch {
      // skip
    }
  }
  return sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function listSessions(
  cwd: string,
  home = os.homedir()
): Promise<SessionEntry[]> {
  return listSessionsFromFiles(cwd, home);
}

export async function loadSessionHistory(
  cwd: string,
  sessionId: string,
  home = os.homedir(),
): Promise<HistoryTurn[]> {
  const rootDir = attachmentRoot(home);
  const manifest = await loadAttachmentManifest(rootDir, sessionId);
  const attachmentsByTurn = new Map<number, HistoryAttachment[]>();
  for (const turn of manifest) {
    const rehydrated = await Promise.all(
      turn.attachments.map((att) => rehydrateAttachment(rootDir, att))
    );
    attachmentsByTurn.set(turn.turnIndex, rehydrated);
  }

  const filePath = join(claudeProjectDir(cwd, home), sessionId + ".jsonl");
  const turns: HistoryTurn[] = [];
  let pendingAssistant = "";
  let userTurnIndex = -1;

  const flushAssistant = (): void => {
    if (!pendingAssistant.trim()) return;
    turns.push({ role: "assistant", text: pendingAssistant.trim(), attachments: [] });
    pendingAssistant = "";
  };

  let stream: fs.ReadStream;
  try {
    stream = fs.createReadStream(filePath);
    // Wait for stream to be readable or end (to detect ENOENT early)
    await new Promise<void>((resolve, reject) => {
      stream.once("error", reject);
      stream.once("readable", resolve);
      stream.once("end", resolve);
    });
  } catch {
    return [];
  }

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(line); } catch { continue; }

    if (obj.type === "user") {
      flushAssistant();
      const content = (obj.message as Record<string, unknown>).content;

      // Skip tool_result turns (internal Claude scaffolding)
      if (Array.isArray(content) && (content[0] as Record<string, unknown>)?.type === "tool_result") continue;

      let text = "";
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          const typed = block as Record<string, unknown>;
          if (typed.type === "text") text += typed.text as string;
        }
      }

      if (text.trim()) {
        userTurnIndex += 1;
        turns.push({
          role: "user",
          text: text.trim(),
          attachments: attachmentsByTurn.get(userTurnIndex) ?? [],
        });
      }
    } else if (obj.type === "assistant") {
      const content = (obj.message as Record<string, unknown>).content as Array<Record<string, unknown>>;
      for (const block of content ?? []) {
        if (block.type === "text") pendingAssistant += block.text as string;
      }
    }
  }

  flushAssistant();
  return turns;
}

export async function countUserTurns(
  cwd: string,
  sessionId: string,
  home = os.homedir(),
): Promise<number> {
  const turns = await loadSessionHistory(cwd, sessionId, home);
  return turns.filter((t) => t.role === "user").length;
}

/** Write a .name sidecar file directly (used as fallback or in test mode). */
async function renameSessionFile(
  cwd: string,
  sessionId: string,
  name: string,
  home: string,
): Promise<void> {
  const metaPath = join(claudeProjectDir(cwd, home), `${sessionId}.name`);
  await mkdir(dirname(metaPath), { recursive: true });
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(metaPath, "utf8")) as Record<string, unknown>;
  } catch {
    existing = {};
  }
  await writeFile(metaPath, JSON.stringify({ ...existing, name, updatedAt: new Date().toISOString() }), "utf8");
}

export async function exportSession(
  cwd: string,
  sessionId: string,
  preset: "clean_summary" | "pr_notes",
  targetPath: string,
  home = os.homedir(),
): Promise<string> {
  const turns = await loadSessionHistory(cwd, sessionId, home);
  if (turns.length === 0) throw new Error("Session has no content to export");

  const sessionName = sessionId.slice(0, 8);
  let md = "";

  if (preset === "clean_summary") {
    md = `---\ntitle: ${sessionName}\ndate: ${new Date().toISOString()}\ncwd: ${cwd}\nsession_id: ${sessionId}\n---\n\n`;
    for (const turn of turns) {
      if (turn.role === "user") {
        md += `## User\n\n${turn.text}\n\n`;
      } else {
        md += `## Claude\n\n${turn.text}\n\n`;
      }
    }
  } else if (preset === "pr_notes") {
    const userPrompts = turns.filter((t) => t.role === "user").map((t) => t.text);
    const lastAssistant = turns.filter((t) => t.role === "assistant").pop()?.text ?? "";
    md = `---\ntitle: PR Notes — ${sessionName}\ndate: ${new Date().toISOString()}\ncwd: ${cwd}\nsession_id: ${sessionId}\n---\n\n## What\n\n`;
    md += userPrompts.map((p) => `- ${p.slice(0, 120)}`).join("\n") + "\n\n";
    md += `## How\n\n${lastAssistant.slice(0, 800)}\n\n## Testing\n\n- [ ] Verify the changes work as expected\n`;
  }

  const dir = dirname(targetPath);
  const base = basename(targetPath, ".md");
  let finalPath = targetPath;
  let n = 1;
  while (true) {
    let fd: fs.promises.FileHandle | undefined;
    try {
      fd = await fs.promises.open(finalPath, "wx");
      await fd.writeFile(md, "utf8");
      await fd.close();
      break;
    } catch (err: unknown) {
      if (fd) await fd.close().catch(() => {});
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        finalPath = join(dir, `${base} (${n}).md`);
        n++;
      } else {
        throw err;
      }
    }
  }
  return finalPath;
}

export async function deleteSession(cwd: string, sessionId: string, home = os.homedir()): Promise<void> {
  const sessionFile = join(claudeProjectDir(cwd, home), sessionId + ".jsonl");
  try {
    await unlink(sessionFile);
  } catch {
    // Already gone.
  }
}

export async function renameSession(
  cwd: string,
  sessionId: string,
  name: string,
  home = os.homedir()
): Promise<void> {
  // When home is overridden (e.g. in tests), write the .name file directly.
  // Otherwise, try the SDK first and fall back to file writing.
  if (home !== os.homedir()) {
    return renameSessionFile(cwd, sessionId, name, home);
  }

  try {
    // SDK signature: renameSession(sessionId, name, options?)
    await sdkRenameSession(sessionId, name);
    // Also write the .name sidecar for local preview metadata (customTitle not always in SDK)
    await renameSessionFile(cwd, sessionId, name, home);
  } catch {
    // SDK unavailable or errored — fall back to writing .name file directly
    await renameSessionFile(cwd, sessionId, name, home);
  }
}
