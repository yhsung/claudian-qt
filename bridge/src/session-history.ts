import * as readline from "readline";
import * as fs from "fs";
import { readdir } from "fs/promises";
import { join } from "path";
import * as os from "os";
import { attachmentRoot, loadAttachmentManifest, rehydrateAttachment } from "./attachment-store.js";
import type { HistoryAttachment, HistoryTurn } from "./protocol.js";

export interface SessionEntry {
  id: string;
  preview: string;
  timestamp: string;
}

// Legacy alias kept for backward compatibility within this file
type TurnEntry = HistoryTurn;

function claudeProjectDir(cwd: string, home = os.homedir()): string {
  return join(home, ".claude", "projects", cwd.replace(/\//g, "-"));
}

export async function listSessions(
  cwd: string,
  home = os.homedir()
): Promise<SessionEntry[]> {
  const dir = claudeProjectDir(cwd, home);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
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

    if (preview) sessions.push({ id: sessionId, preview, timestamp });
  }

  return sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
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
