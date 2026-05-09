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
      { mediaType: "image/png", stagedPath },
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
});
