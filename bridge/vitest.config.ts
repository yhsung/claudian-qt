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
  },
});
