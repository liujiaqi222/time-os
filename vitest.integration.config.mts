import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: process.env.TIMEOS_TEST_SCHEMA ? 180_000 : 20_000,
    hookTimeout: process.env.TIMEOS_TEST_SCHEMA ? 90_000 : 30_000,
  },
});
