import * as readline from "readline";
import * as fs from "fs";
import { readdir } from "fs/promises";
import { join } from "path";
import * as os from "os";

export interface SessionEntry {
  id: string;
  preview: string;
  timestamp: string;
}

export interface TurnEntry {
  role: "user" | "assistant";
  text: string;
}

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
  home = os.homedir()
): Promise<TurnEntry[]> {
  const filePath = join(claudeProjectDir(cwd, home), sessionId + ".jsonl");
  const turns: TurnEntry[] = [];
  let pendingAssistant = "";

  const flushAssistant = (): void => {
    if (!pendingAssistant.trim()) return;
    turns.push({ role: "assistant", text: pendingAssistant.trim() });
    pendingAssistant = "";
  };

  let stream: fs.ReadStream;
  try {
    stream = fs.createReadStream(filePath);
    // Verify the stream can be opened by waiting for the first event
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
      if (Array.isArray(content) && (content[0] as Record<string, unknown>)?.type === "tool_result") continue;
      let text = "";
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) {
        for (const b of content) {
          if ((b as Record<string, unknown>).type === "text") text += (b as Record<string, unknown>).text as string;
        }
      }
      if (text.trim()) turns.push({ role: "user", text: text.trim() });

    } else if (obj.type === "assistant") {
      const content = (obj.message as Record<string, unknown>).content as Array<Record<string, unknown>>;
      for (const b of content ?? []) {
        if (b.type === "text") pendingAssistant += b.text as string;
      }
    }
  }

  flushAssistant();
  return turns;
}
