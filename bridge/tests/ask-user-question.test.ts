import { describe, it, expect } from "vitest";
import type { AskUserQuestionItem } from "../src/protocol.js";

describe("ask_user_question protocol shape", () => {
  it("carries requestId and questions array", () => {
    const item: AskUserQuestionItem = {
      question: "Which auth strategy?",
      header: "Auth",
      options: [{ label: "JWT", description: "JSON Web Token" }],
      multiSelect: false,
    };
    const event = {
      type: "ask_user_question" as const,
      requestId: "ask_123",
      questions: [item],
    };
    expect(event.type).toBe("ask_user_question");
    expect(event.questions[0].header).toBe("Auth");
  });

  it("ask_user_response carries answers map", () => {
    const cmd = {
      type: "ask_user_response" as const,
      requestId: "ask_123",
      answers: { "Which auth strategy?": "JWT" },
    };
    expect(cmd.answers["Which auth strategy?"]).toBe("JWT");
  });
});
