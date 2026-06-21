import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The runner/orchestrator tests spawn real `node --test` subprocesses. When the
    // whole workspace suite runs in parallel, cold-start + run can exceed vitest's
    // 5s default per-test timeout under CPU contention (a single spawn is ~1.5s, but
    // many spawn at once across workers). 30s matches runPredicate's own default
    // timeout and keeps the suite deterministic regardless of machine load.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
