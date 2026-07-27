import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    // Parallel workers keep their git worktrees under .worktrees/, each a full
    // checkout of this repo. Without this the gate collects every sibling's
    // in-flight tests and nobody can tell their own failures from a teammate's.
    // Spread the defaults: a bare exclude replaces them, dropping node_modules.
    exclude: [...defaultExclude, "**/.worktrees/**"],
  },
});
