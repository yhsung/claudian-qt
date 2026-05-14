import { describe, it, expect } from "vitest";

describe("SDK session function availability", () => {
  it("can import session-history functions", async () => {
    const { listSessions, loadSessionHistory, renameSession } = await import("../src/session-history.js");
    expect(typeof listSessions).toBe("function");
    expect(typeof loadSessionHistory).toBe("function");
    expect(typeof renameSession).toBe("function");
  });

  it("listSessions returns array for nonexistent cwd", async () => {
    const { listSessions } = await import("../src/session-history.js");
    const result = await listSessions("/nonexistent/path/xyz123");
    expect(Array.isArray(result)).toBe(true);
  });
});
