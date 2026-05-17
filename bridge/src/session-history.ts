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
  tags?: string[];
  archived?: boolean;
  exportedAt?: string;
  exportedStem?: string;
  summary?: string;
}

interface SessionMeta {
  tags?: string[];
  archived?: boolean;
  exportedAt?: string;
  exportedStem?: string;
  summary?: string;
}

interface SearchResult {
  sessionId: string;
  sessionName?: string;
  hitCount: number;
  excerpt: string;
}

// Legacy alias kept for backward compatibility within this file
type TurnEntry = HistoryTurn;

export function buildFrontmatter(fields: Record<string, string | string[] | undefined>): string {
  function yamlQuote(val: string): string {
    const needsQuoting = /[:#\[\]{}|>*&!'"%]|^\s|\s$/.test(val) || val === "";
    if (!needsQuoting) return val;
    return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  const lines = ["---"];
  for (const [key, val] of Object.entries(fields)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      if (val.length === 0) continue;
      lines.push(`${key}:`);
      val.forEach(v => lines.push(`  - ${yamlQuote(v)}`));
    } else {
      lines.push(`${key}: ${yamlQuote(val)}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

function claudeProjectDir(cwd: string, home = os.homedir()): string {
  return join(home, ".claude", "projects", cwd.replace(/\//g, "-"));
}

function metaPath(cwd: string, sessionId: string, home: string): string {
  return join(claudeProjectDir(cwd, home), `${sessionId}.meta`);
}

async function readSessionMeta(cwd: string, sessionId: string, home: string): Promise<SessionMeta> {
  const sessionMeta: SessionMeta = {};
  try {
    const metaRaw = await readFile(metaPath(cwd, sessionId, home), "utf8");
    const meta = JSON.parse(metaRaw) as Record<string, unknown>;
    if (Array.isArray(meta.tags)) sessionMeta.tags = meta.tags as string[];
    if (typeof meta.archived === "boolean") sessionMeta.archived = meta.archived;
    if (typeof meta.exportedAt === "string") sessionMeta.exportedAt = meta.exportedAt;
    if (typeof meta.exportedStem === "string") sessionMeta.exportedStem = meta.exportedStem;
    if (typeof meta.summary === "string") sessionMeta.summary = meta.summary;
  } catch {
    // no .meta file — session has no ClaudianQt private metadata
  }
  return sessionMeta;
}

function applySessionMeta(entry: SessionEntry, sessionMeta: SessionMeta): void {
  if (sessionMeta.tags !== undefined) entry.tags = sessionMeta.tags;
  if (sessionMeta.archived !== undefined) entry.archived = sessionMeta.archived;
  if (sessionMeta.exportedAt !== undefined) entry.exportedAt = sessionMeta.exportedAt;
  if (sessionMeta.exportedStem !== undefined) entry.exportedStem = sessionMeta.exportedStem;
  if (sessionMeta.summary !== undefined) entry.summary = sessionMeta.summary;
}

export async function updateSessionMeta(
  cwd: string,
  sessionId: string,
  updates: Partial<{ tags: string[]; archived: boolean; exportedAt: string; exportedStem: string; summary: string }>,
  home: string,
): Promise<void> {
  const mp = metaPath(cwd, sessionId, home);
  await mkdir(dirname(mp), { recursive: true });
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(await readFile(mp, "utf8")) as Record<string, unknown>; } catch {}
  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  );
  await writeFile(mp, JSON.stringify({ ...existing, ...cleanUpdates }), "utf8");
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
      applySessionMeta(entry, await readSessionMeta(cwd, sessionId, home));
      sessions.push(entry);
    }
  }

  // Add orphan .name files (brand-new sessions renamed before first message)
  for (const sessionId of orphanNames) {
    try {
      const metaRaw = await readFile(join(dir, `${sessionId}.name`), "utf8");
      const meta = JSON.parse(metaRaw);
      if (meta.name) {
        const entry: SessionEntry = {
          id: sessionId,
          preview: "(new session)",
          timestamp: new Date().toISOString(),
          name: meta.name,
        };
        applySessionMeta(entry, await readSessionMeta(cwd, sessionId, home));
        sessions.push(entry);
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

export async function getExportedSiblingStems(
  cwd: string,
  excludeSessionId: string,
  home = os.homedir(),
): Promise<string[]> {
  const sessions = await listSessions(cwd, home);
  return sessions
    .filter((s) => s.exportedAt != null && s.id !== excludeSessionId && s.exportedStem != null)
    .sort((a, b) => (b.exportedAt ?? "").localeCompare(a.exportedAt ?? ""))
    .slice(0, 50)
    .map((s) => s.exportedStem as string);
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

export function truncateForPrompt(turns: HistoryTurn[], maxChars = 24000): string {
  const blocks: string[] = [];
  let total = 0;
  let truncated = false;
  for (const turn of [...turns].reverse()) {
    const block = turn.role === "user"
      ? `## User\n\n${turn.text}\n\n`
      : `## Claude\n\n${turn.text}\n\n`;
    if (total + block.length > maxChars) {
      truncated = true;
      break;
    }
    blocks.unshift(block);
    total += block.length;
  }
  const prefix = truncated ? "[session truncated — showing most recent turns]\n\n" : "";
  return prefix + blocks.join("");
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
  preset: "clean_summary" | "pr_notes" | "pr_notes_llm" | "adr",
  targetPath: string,
  home = os.homedir(),
  llmContent?: string,
  relatedStems?: string[],
  templateContent?: string,
): Promise<string> {
  const turns = await loadSessionHistory(cwd, sessionId, home);
  if (turns.length === 0) throw new Error("Session has no content to export");

  const sessionName = sessionId.slice(0, 8);
  const meta = await readSessionMeta(cwd, sessionId, home);
  const frontmatter = (title: string) => buildFrontmatter({
    title,
    date: new Date().toISOString(),
    cwd,
    session_id: sessionId,
    tags: meta.tags,
    related: relatedStems && relatedStems.length > 0 ? relatedStems : undefined,
    summary: meta.summary,
  });
  const cleanSummaryBody = turns.map((turn) => (
    turn.role === "user"
      ? `## User\n\n${turn.text}\n\n`
      : `## Claude\n\n${turn.text}\n\n`
  )).join("");
  const prNotesTemplateBody = (): string => {
    const userPrompts = turns.filter((t) => t.role === "user").map((t) => t.text);
    const lastAssistant = turns.filter((t) => t.role === "assistant").pop()?.text ?? "";
    return "## What\n\n" +
      userPrompts.map((p) => `- ${p.slice(0, 120)}`).join("\n") + "\n\n" +
      `## How\n\n${lastAssistant.slice(0, 800)}\n\n## Testing\n\n- [ ] Verify the changes work as expected\n`;
  };
  let md = "";

  if (templateContent?.trim()) {
    const userPrompts = turns.filter((t) => t.role === "user").map((t) => `- ${t.text}`).join("\n");
    const assistantResponses = turns.filter((t) => t.role === "assistant").map((t) => t.text).join("\n\n");
    const substitutions: Array<[string, string]> = [
      ["{{title}}", sessionName],
      ["{{date}}", new Date().toISOString()],
      ["{{cwd}}", cwd],
      ["{{prompts}}", userPrompts],
      ["{{responses}}", assistantResponses],
      // TODO: tools
      ["{{tools}}", ""],
    ];
    let chunks = [{ text: templateContent, resolved: false }];
    for (const [token, resolvedValue] of substitutions) {
      chunks = chunks.flatMap((chunk) => {
        if (chunk.resolved) return [chunk];
        const parts = chunk.text.split(token);
        return parts.flatMap((part, index) => (
          index === parts.length - 1
            ? [{ text: part, resolved: false }]
            : [{ text: part, resolved: false }, { text: resolvedValue, resolved: true }]
        ));
      });
    }
    const body = chunks.map((chunk) => chunk.text).join("");
    md = frontmatter(sessionName) + body;
  } else if (preset === "clean_summary") {
    md = frontmatter(sessionName) + cleanSummaryBody;
  } else if (preset === "pr_notes") {
    md = frontmatter(`PR Notes — ${sessionName}`) + prNotesTemplateBody();
  } else if (preset === "pr_notes_llm") {
    md = frontmatter(`PR Notes — ${sessionName}`) + (llmContent?.trim() || prNotesTemplateBody());
  } else if (preset === "adr") {
    const adrText = llmContent?.trim();
    md = frontmatter(sessionName) + cleanSummaryBody;
    if (adrText) md += `\n\n## Architecture Decisions\n\n${adrText}\n`;
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
  await updateSessionMeta(cwd, sessionId, {
    exportedAt: new Date().toISOString(),
    exportedStem: basename(finalPath, ".md"),
  }, home);
  return finalPath;
}

export async function deleteSession(cwd: string, sessionId: string, home = os.homedir()): Promise<void> {
  const sessionFile = join(claudeProjectDir(cwd, home), sessionId + ".jsonl");
  const mp = metaPath(cwd, sessionId, home);
  await Promise.allSettled([unlink(sessionFile), unlink(mp)]);
}

function extractTextFromContent(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content
    .filter((block): block is Record<string, unknown> => typeof block === "object" && block !== null)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string);
}

function extractLineTexts(obj: Record<string, unknown>): string[] {
  const message = obj.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== "object") return [];
  if (obj.type === "user" || obj.type === "assistant") {
    return extractTextFromContent(message.content);
  }
  return [];
}

export async function searchSessions(
  cwd: string,
  query: string,
  home = os.homedir(),
): Promise<SearchResult[]> {
  const q = query.toLowerCase();
  if (!q) return [];

  const dir = claudeProjectDir(cwd, home);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const results: SearchResult[] = [];
  for (const filename of files.filter((f) => f.endsWith(".jsonl"))) {
    const sessionId = filename.slice(0, -6);
    let lines: string[] = [];
    try {
      const rl = readline.createInterface({
        input: fs.createReadStream(join(dir, filename)),
        crlfDelay: Infinity,
      });
      for await (const line of rl) lines.push(line);
      rl.close();
    } catch {
      continue;
    }

    lines = lines.slice(-50000);
    let hitCount = 0;
    let excerpt = "";
    for (const line of lines) {
      if (!line.toLowerCase().includes(q)) continue;
      let obj: Record<string, unknown>;
      try { obj = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      for (const text of extractLineTexts(obj)) {
        if (!text.toLowerCase().includes(q)) continue;
        hitCount++;
        if (!excerpt) excerpt = text.slice(0, 100);
      }
    }

    if (hitCount > 0) {
      const result: SearchResult = { sessionId, hitCount, excerpt };
      try {
        const metaRaw = await readFile(join(dir, `${sessionId}.name`), "utf8");
        const meta = JSON.parse(metaRaw) as Record<string, unknown>;
        if (typeof meta.name === "string") result.sessionName = meta.name;
      } catch {
        // no .name file — session has no custom name
      }
      results.push(result);
    }
  }

  return results.sort((a, b) => b.hitCount - a.hitCount);
}

export async function tagSession(cwd: string, sessionId: string, tags: string[], home = os.homedir()): Promise<void> {
  await updateSessionMeta(cwd, sessionId, { tags }, home);
}

export async function archiveSession(cwd: string, sessionId: string, archived: boolean, home = os.homedir()): Promise<void> {
  await updateSessionMeta(cwd, sessionId, { archived }, home);
}

export async function renameSession(
  cwd: string,
  sessionId: string,
  name: string,
  home = os.homedir()
): Promise<void> {
  // Always write the local .name sidecar first so the daemon stays responsive.
  if (home !== os.homedir()) {
    return renameSessionFile(cwd, sessionId, name, home);
  }

  await renameSessionFile(cwd, sessionId, name, home).catch(() => {});
  try {
    await Promise.race([
      sdkRenameSession(sessionId, name),
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
  } catch {
    // SDK unavailable or errored — local .name sidecar is already updated.
  }
}
