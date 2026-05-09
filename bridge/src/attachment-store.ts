import { mkdir, readFile, rename, writeFile } from "fs/promises";
import * as os from "os";
import { dirname, extname, join } from "path";
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
  const destDir = turnDir(args.rootDir, args.sessionId, args.turnIndex);
  await mkdir(destDir, { recursive: true });

  const finalized: HistoryAttachment[] = [];
  for (const [index, attachment] of args.attachments.entries()) {
    const ext = extname(attachment.originalName) || ".img";
    const filename = `${String(index).padStart(2, "0")}-${attachment.id}${ext}`;
    const absolutePath = join(destDir, filename);
    await rename(attachment.stagedPath, absolutePath);
    finalized.push({
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      relativePath: join("sessions", args.sessionId, `turn-${String(args.turnIndex).padStart(4, "0")}`, filename),
      fileUrl: pathToFileURL(absolutePath).toString(),
      sizeBytes: attachment.sizeBytes,
      width: attachment.width,
      height: attachment.height,
    });
  }

  return finalized;
}

export async function loadAttachmentManifest(
  rootDir: string,
  sessionId: string,
): Promise<ManifestTurn[]> {
  try {
    return JSON.parse(await readFile(manifestPath(rootDir, sessionId), "utf8")) as ManifestTurn[];
  } catch {
    return [];
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
