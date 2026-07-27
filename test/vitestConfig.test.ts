import { describe, expect, it } from "vitest";
import { defaultExclude } from "vitest/config";

import rootConfig from "../vitest.config.js";

const testConfig = rootConfig.test ?? {};

describe("root vitest config", () => {
  it("excludes sibling git worktrees, so the gate only collects this checkout", () => {
    expect(testConfig.exclude).toContain("**/.worktrees/**");
  });

  it("keeps every vitest default exclude, because a bare exclude replaces them", () => {
    for (const pattern of defaultExclude) {
      expect(testConfig.exclude).toContain(pattern);
    }
  });

  it("never collects installed dependencies", () => {
    expect(testConfig.exclude).toContain("**/node_modules/**");
  });

  it("passes a package that has no tests yet", () => {
    expect(testConfig.passWithNoTests).toBe(true);
  });

  // Slow determinism tests declare their own per-test budget (653793c) so the
  // number sits next to the test it governs. A global one would hide that.
  it("declares no global test timeout", () => {
    expect(testConfig.testTimeout).toBeUndefined();
  });
});
