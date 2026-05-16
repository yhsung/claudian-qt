import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  appendManifestTurn,
  finalizeAttachmentsForTurn,
  loadAttachmentManifest,
  rehydrateAttachment,
} from "../src/attachment-store.js";
import type { HistoryAttachment, OutboundAttachment } from "../src/protocol.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOutbound(id: string, stagedPath: string): OutboundAttachment {
  return {
    id,
    originalName: `${id}.png`,
    mimeType: "image/png",
    stagedPath,
    fileUrl: "file://" + stagedPath,
    sizeBytes: 4,
    width: 100,
    height: 100,
  };
}

// ---------------------------------------------------------------------------
// finalizeAttachmentsForTurn
// ---------------------------------------------------------------------------

describe("finalizeAttachmentsForTurn", () => {
  it("finalizes staged attachments and returns HistoryAttachment array", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "claudian-attachment-store-"));
    const stagedPath = join(rootDir, "staging", "att-1.png");
    await mkdir(join(rootDir, "staging"), { recursive: true });
    await writeFile(stagedPath, Buffer.from("fake-png"));

    const finalized = await finalizeAttachmentsForTurn({
      rootDir,
      sessionId: "session-1",
      turnIndex: 0,
      attachments: [makeOutbound("att-1", stagedPath)],
    });

    expect(finalized).toHaveLength(1);
    expect(finalized[0].id).toBe("att-1");
    expect(finalized[0].mimeType).toBe("image/png");
    expect(finalized[0].relativePath).toContain("turn-0000");
    expect(finalized[0].fileUrl).toMatch(/^file:\/\//);

    const destFile = join(rootDir, "sessions", "session-1", "turn-0000", "00-att-1.png");
    expect(await readFile(destFile)).toEqual(Buffer.from("fake-png"));
  });

  it("returns empty array for zero attachments (no destDir created)", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "claudian-attachment-store-empty-"));

    const finalized = await finalizeAttachmentsForTurn({
      rootDir,
      sessionId: "session-empty",
      turnIndex: 0,
      attachments: [],
    });

    expect(finalized).toEqual([]);
    // No session directory should be created when there are no attachments
    await expect(readdir(join(rootDir, "sessions"))).rejects.toThrow(/ENOENT/);
  });

  it("pads turn index to 4 digits in the directory name", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "claudian-attachment-store-pad-"));
    const stagedPath = join(rootDir, "att.png");
    await writeFile(stagedPath, Buffer.from("x"));

    const finalized = await finalizeAttachmentsForTurn({
      rootDir,
      sessionId: "s",
      turnIndex: 12,
      attachments: [makeOutbound("att", stagedPath)],
    });

    expect(finalized[0].relativePath).toContain("turn-0012");
  });

  it("rolls back destDir on rename failure mid-batch", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "claudian-attachment-rollback-"));
    const stagingDir = join(rootDir, "staging");
    await mkdir(stagingDir, { recursive: true });

    const goodPath = join(stagingDir, "att-good.png");
    await writeFile(goodPath, Buffer.from("good"));
    const missingPath = join(stagingDir, "att-missing.png"); // intentionally absent

    await expect(
      finalizeAttachmentsForTurn({
        rootDir,
        sessionId: "rollback-session",
        turnIndex: 0,
        attachments: [
          makeOutbound("att-good", goodPath),
          makeOutbound("att-missing", missingPath),
        ],
      })
    ).rejects.toThrow(/Failed to finalize/);

    // destDir must be cleaned up by the rollback
    await expect(
      readdir(join(rootDir, "sessions", "rollback-session", "turn-0000"))
    ).rejects.toThrow(/ENOENT/);
  });
});

// ---------------------------------------------------------------------------
// loadAttachmentManifest
// ---------------------------------------------------------------------------

describe("loadAttachmentManifest", () => {
  it("returns empty array when manifest file does not exist", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "claudian-manifest-missing-"));
    expect(await loadAttachmentManifest(rootDir, "no-session")).toEqual([]);
  });

  it("throws on corrupt (non-JSON) manifest content", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "claudian-manifest-corrupt-"));
    const manifestDir = join(rootDir, "sessions", "bad-session");
    await mkdir(manifestDir, { recursive: true });
    await writeFile(join(manifestDir, "manifest.json"), "not valid json {{{}");

    await expect(loadAttachmentManifest(rootDir, "bad-session")).rejects.toThrow(
      /corrupt or unreadable/
    );
  });
});

// ---------------------------------------------------------------------------
// appendManifestTurn
// ---------------------------------------------------------------------------

describe("appendManifestTurn", () => {
  it("finalizes staged attachments and appends a manifest turn", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "claudian-attachment-store-"));
    const stagedPath = join(rootDir, "staging", "att-1.png");
    await mkdir(join(rootDir, "staging"), { recursive: true });
    await writeFile(stagedPath, Buffer.from("fake-png"));

    const finalized = await finalizeAttachmentsForTurn({
      rootDir,
      sessionId: "session-1",
      turnIndex: 0,
      attachments: [makeOutbound("att-1", stagedPath)],
    });

    await appendManifestTurn({
      rootDir,
      sessionId: "session-1",
      turnIndex: 0,
      attachments: finalized,
    });

    expect(await readFile(join(rootDir, "sessions", "session-1", "turn-0000", "00-att-1.png"))).toEqual(Buffer.from("fake-png"));
    expect(await loadAttachmentManifest(rootDir, "session-1")).toEqual([
      expect.objectContaining({
        turnIndex: 0,
        attachments: [expect.objectContaining({ id: "att-1", mimeType: "image/png" })],
      }),
    ]);
  });

  it("appends subsequent turns to an existing manifest", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "claudian-manifest-append-"));

    const makeHistory = (id: string, relativePath: string): HistoryAttachment => ({
      id,
      originalName: `${id}.png`,
      mimeType: "image/png",
      relativePath,
      fileUrl: "file:///fake",
      sizeBytes: 4,
    });

    await appendManifestTurn({
      rootDir,
      sessionId: "multi-sess",
      turnIndex: 0,
      attachments: [makeHistory("att-a", "sessions/multi-sess/turn-0000/00-att-a.png")],
    });
    await appendManifestTurn({
      rootDir,
      sessionId: "multi-sess",
      turnIndex: 1,
      attachments: [makeHistory("att-b", "sessions/multi-sess/turn-0001/00-att-b.png")],
    });

    const manifest = await loadAttachmentManifest(rootDir, "multi-sess");
    expect(manifest).toHaveLength(2);
    expect(manifest[0].turnIndex).toBe(0);
    expect(manifest[0].attachments[0].id).toBe("att-a");
    expect(manifest[1].turnIndex).toBe(1);
    expect(manifest[1].attachments[0].id).toBe("att-b");
  });
});

// ---------------------------------------------------------------------------
// rehydrateAttachment
// ---------------------------------------------------------------------------

describe("rehydrateAttachment", () => {
  it("replaces fileUrl with a base64 data URL from disk", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "claudian-rehydrate-"));
    const relPath = "sessions/s1/turn-0000/00-att.png";
    const absPath = join(rootDir, relPath);
    await mkdir(join(rootDir, "sessions", "s1", "turn-0000"), { recursive: true });
    const bytes = Buffer.from("png-bytes");
    await writeFile(absPath, bytes);

    const att: HistoryAttachment = {
      id: "att-1",
      originalName: "photo.png",
      mimeType: "image/png",
      relativePath: relPath,
      fileUrl: "file://" + absPath,
      sizeBytes: bytes.length,
    };

    const result = await rehydrateAttachment(rootDir, att);
    expect(result.fileUrl).toBe(`data:image/png;base64,${bytes.toString("base64")}`);
    // Other fields unchanged
    expect(result.id).toBe("att-1");
    expect(result.originalName).toBe("photo.png");
  });

  it("returns original attachment unchanged when file is missing", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "claudian-rehydrate-miss-"));

    const att: HistoryAttachment = {
      id: "att-missing",
      originalName: "ghost.png",
      mimeType: "image/png",
      relativePath: "sessions/s/turn-0000/00-ghost.png",
      fileUrl: "file:///original-url",
      sizeBytes: 0,
    };

    const result = await rehydrateAttachment(rootDir, att);
    expect(result).toEqual(att); // unchanged
  });
});
