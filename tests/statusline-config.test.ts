import { describe, expect, it } from "vitest";
import { parseStatuslineFieldArguments } from "../src/lib/statusline-config.js";

describe("parseStatuslineFieldArguments", () => {
  it("preserves selection order", () => {
    expect(parseStatuslineFieldArguments("branch repo ctx_max 5h tokens").fields).toEqual([
      "branch",
      "repo",
      "context_length",
      "quota_5h",
      "session_total"
    ]);
  });

  it("supports clear", () => {
    expect(parseStatuslineFieldArguments("clear").clear).toBe(true);
  });
});
