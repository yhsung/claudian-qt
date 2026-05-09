import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  appendManifestTurn,
  finalizeAttachmentsForTurn,
  loadAttachmentManifest,
} from "../src/attachment-store.js";
import type { OutboundAttachment } from "../src/protocol.js";

describe("attachment-store", () => {
  it("finalizes staged attachments and appends a manifest turn", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "claudian-attachment-store-"));
    const stagedPath = join(rootDir, "staging", "att-1.png");
    await mkdir(join(rootDir, "staging"), { recursive: true });
    await writeFile(stagedPath, Buffer.from("fake-png"));

    const finalized = await finalizeAttachmentsForTurn({
      rootDir,
      sessionId: "session-1",
      turnIndex: 0,
      attachments: [{
        id: "att-1",
        originalName: "diagram.png",
        mimeType: "image/png",
        stagedPath,
        fileUrl: "file://" + stagedPath,
        sizeBytes: 8,
        width: 320,
        height: 200,
      } satisfies OutboundAttachment],
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
});
