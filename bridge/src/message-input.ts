import { readFile } from "fs/promises";
import type { MessageParam, TextBlockParam, ImageBlockParam } from "@anthropic-ai/sdk/resources";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { OutboundAttachment } from "./protocol.js";

export async function buildUserMessage(prompt: string, attachments: OutboundAttachment[] = []): Promise<SDKUserMessage> {
  const content: Array<TextBlockParam | ImageBlockParam> = [{ type: "text", text: prompt }];

  for (const attachment of attachments) {
    const bytes = await readFile(attachment.stagedPath);
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mediaType,
        data: bytes.toString("base64"),
      },
    });
  }

  const message: MessageParam = {
    role: "user",
    content,
  };

  return {
    type: "user",
    message,
    parent_tool_use_id: null,
    shouldQuery: true,
  };
}
