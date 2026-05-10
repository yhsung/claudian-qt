import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import * as os from "os";
import { dirname, extname, join, posix as posixPath } from "path";
import { pathToFileURL } from "url";
import type { HistoryAttachment, OutboundAttachment } from "./protocol.js";

export interface ManifestTurn {
  turnIndex: number;
  attachments: HistoryAttachment[];
}

export function attachmentRoot(home = os.homedir()): string {
  return join(home, ".claudian-qt", "attachments");
}

function manifestPath(rootDir: string, sessionId: string): string {
  return join(rootDir, "sessions", sessionId, "manifest.json");
}

function turnDir(rootDir: string, sessionId: string, turnIndex: number): string {
  return join(rootDir, "sessions", sessionId, `turn-${String(turnIndex).padStart(4, "0")}`);
}

export async function finalizeAttachmentsForTurn(args: {
  rootDir: string;
  sessionId: string;
  turnIndex: number;
  attachments: OutboundAttachment[];
}): Promise<HistoryAttachment[]> {
  if (args.attachments.length === 0) return [];

  const destDir = turnDir(args.rootDir, args.sessionId, args.turnIndex);
  await mkdir(destDir, { recursive: true });

  const finalized: HistoryAttachment[] = [];
  try {
    for (const [index, attachment] of args.attachments.entries()) {
      const ext = extname(attachment.originalName) || ".img";
      const filename = `${String(index).padStart(2, "0")}-${attachment.id}${ext}`;
      const absolutePath = join(destDir, filename);
      await rename(attachment.stagedPath, absolutePath);
      finalized.push({
        id: attachment.id,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        relativePath: posixPath.join("sessions", args.sessionId, `turn-${String(args.turnIndex).padStart(4, "0")}`, filename),
        fileUrl: pathToFileURL(absolutePath).toString(),
        sizeBytes: attachment.sizeBytes,
        width: attachment.width,
        height: attachment.height,
      });
    }
  } catch (err) {
    await rm(destDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(
      `Failed to finalize attachments for turn ${args.turnIndex}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return finalized;
}

export async function loadAttachmentManifest(
  rootDir: string,
  sessionId: string,
): Promise<ManifestTurn[]> {
  try {
    return JSON.parse(await readFile(manifestPath(rootDir, sessionId), "utf8")) as ManifestTurn[];
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw new Error(
      `Manifest for session ${sessionId} is corrupt or unreadable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function appendManifestTurn(args: {
  rootDir: string;
  sessionId: string;
  turnIndex: number;
  attachments: HistoryAttachment[];
}): Promise<void> {
  const existing = await loadAttachmentManifest(args.rootDir, args.sessionId);
  const next = [...existing, { turnIndex: args.turnIndex, attachments: args.attachments }];
  const path = manifestPath(args.rootDir, args.sessionId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2));
}

// Re-read the attachment file from disk and return a base64 data URL.
// file:// URLs stored in the manifest cannot load from the qrc:// WebEngine page.
export async function rehydrateAttachment(
  rootDir: string,
  att: HistoryAttachment,
): Promise<HistoryAttachment> {
  try {
    const bytes = await readFile(join(rootDir, att.relativePath));
    return { ...att, fileUrl: `data:${att.mimeType};base64,${bytes.toString("base64")}` };
  } catch {
    return att;
  }
}
