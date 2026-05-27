import { describe, expect, it } from "vitest";
import { parseStatuslineFieldArguments } from "../src/lib/statusline-config.js";

describe("parseStatuslineFieldArguments", () => {
  it("preserves selection order", () => {
    expect(parseStatuslineFieldArguments("branch repo ctx_max ttft 5h tokens").fields).toEqual([
      "branch",
      "repo",
      "context_length",
      "generation_metrics",
      "quota_5h",
      "session_total"
    ]);
  });

  it("supports clear", () => {
    expect(parseStatuslineFieldArguments("clear").clear).toBe(true);
  });

  it("supports session cost aliases", () => {
    expect(parseStatuslineFieldArguments("cost spent usd").fields).toEqual(["session_cost"]);
  });
});
