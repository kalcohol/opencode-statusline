import { describe, expect, it } from "vitest";
import { parseStatuslineFieldArguments } from "../src/lib/statusline-config.js";

describe("parseStatuslineFieldArguments", () => {
  it("preserves selection order", () => {
    expect(parseStatuslineFieldArguments("branch repo 5h tokens").fields).toEqual([
      "branch",
      "repo",
      "quota_5h",
      "session_total"
    ]);
  });

  it("supports clear", () => {
    expect(parseStatuslineFieldArguments("clear").clear).toBe(true);
  });
});

