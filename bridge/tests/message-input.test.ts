import { describe, it, expect } from "vitest";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { buildUserMessage } from "../src/message-input.js";

const TMP = join(tmpdir(), "claudian-message-input-" + process.pid);

describe("buildUserMessage", () => {
  it("builds a Claude SDK user message with text and image attachments", async () => {
    await mkdir(TMP, { recursive: true });
    const stagedPath = join(TMP, "sample.png");
    const pngBytes = Buffer.from("89504e470d0a1a0a", "hex");
    await writeFile(stagedPath, pngBytes);

    const message = await buildUserMessage("look at this", [
      {
        id: "att-sample",
        originalName: "sample.png",
        mimeType: "image/png",
        stagedPath,
        fileUrl: "file://" + stagedPath,
        sizeBytes: pngBytes.length,
      },
    ]);

    expect(message).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: pngBytes.toString("base64"),
            },
          },
        ],
      },
      parent_tool_use_id: null,
      shouldQuery: true,
    });
  });

  it("builds a text-only message when no attachments are provided", async () => {
    const message = await buildUserMessage("hello");

    expect(message).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
      parent_tool_use_id: null,
      shouldQuery: true,
    });
  });

  it("builds a text-only message when an empty attachment array is provided", async () => {
    const message = await buildUserMessage("empty list", []);

    expect(message.message.content).toHaveLength(1);
    expect((message.message.content as Array<{ type: string }>)[0].type).toBe("text");
  });

  it("includes multiple image blocks in order", async () => {
    await mkdir(TMP, { recursive: true });
    const file1 = join(TMP, "img1.png");
    const file2 = join(TMP, "img2.png");
    const bytes1 = Buffer.from("first");
    const bytes2 = Buffer.from("second");
    await writeFile(file1, bytes1);
    await writeFile(file2, bytes2);

    const message = await buildUserMessage("two images", [
      { id: "a1", originalName: "img1.png", mimeType: "image/png", stagedPath: file1, fileUrl: "file://" + file1, sizeBytes: bytes1.length },
      { id: "a2", originalName: "img2.png", mimeType: "image/png", stagedPath: file2, fileUrl: "file://" + file2, sizeBytes: bytes2.length },
    ]);

    const content = message.message.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(3); // text + 2 images
    expect(content[0].type).toBe("text");
    expect(content[1].type).toBe("image");
    expect(content[2].type).toBe("image");
    expect((content[1].source as Record<string, unknown>).data).toBe(bytes1.toString("base64"));
    expect((content[2].source as Record<string, unknown>).data).toBe(bytes2.toString("base64"));
  });

  it("rejects when the staged file does not exist", async () => {
    await expect(
      buildUserMessage("oops", [
        {
          id: "bad",
          originalName: "missing.png",
          mimeType: "image/png",
          stagedPath: join(TMP, "nonexistent-file.png"),
          fileUrl: "file:///nonexistent",
          sizeBytes: 0,
        },
      ])
    ).rejects.toThrow(/ENOENT/);
  });

  it("builds a message with empty prompt text and valid attachments", async () => {
    await mkdir(TMP, { recursive: true });
    const stagedPath = join(TMP, "attachment-only.png");
    const pngBytes = Buffer.from("datadata");
    await writeFile(stagedPath, pngBytes);

    const message = await buildUserMessage("", [
      {
        id: "att-empty-prompt",
        originalName: "attachment-only.png",
        mimeType: "image/png",
        stagedPath,
        fileUrl: "file://" + stagedPath,
        sizeBytes: pngBytes.length,
      },
    ]);

    expect(message.message.content).toHaveLength(2);
    const content = message.message.content as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: "text", text: "" });
    expect(content[1].type).toBe("image");
  });

  it("includes whitespace-only prompt text in the text block", async () => {
    const message = await buildUserMessage("   ", []);

    const content = message.message.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({ type: "text", text: "   " });
  });
});
