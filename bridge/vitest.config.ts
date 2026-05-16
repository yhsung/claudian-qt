import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/**/*.test.ts",
      "tests/frontend/**/*.test.ts",
    ],
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // daemon.ts and index.ts are tested via subprocess spawning (daemon.test.ts,
      // agent-sdk-parity.test.ts, bridge.test.ts) — v8 cannot trace child processes.
      // protocol.ts is a pure type-definition file.
      exclude: [
        "src/protocol.ts",
        "src/daemon.ts",
        "src/index.ts",
      ],
      reporter: ["text", "text-summary"],
      thresholds: {
        lines: 80,
        branches: 70,
        functions: 90,
      },
    },
  },
});
