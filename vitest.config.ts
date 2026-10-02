import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    env: {
      PERIXIA_OUT_DIR: path.join(os.tmpdir(), "perixia-test-out"),
      FECHA_EVALUACION: "2026-10-01",
    },
  },
});
