import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATUSLINE_FIELDS,
  normalizeStatuslineFields,
  parseStatuslineFieldArguments,
  toggleStatuslineField
} from "../src/lib/statusline-config.js";

describe("parseStatuslineFieldArguments", () => {
  it("preserves selection order", () => {
    expect(parseStatuslineFieldArguments("branch repo ctx_max speed 5h tokens").fields).toEqual([
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

  it("supports git diff aliases", () => {
    expect(parseStatuslineFieldArguments("diff changes git_diff").fields).toEqual(["git_diff_stats"]);
  });

  it("supports provider balance aliases", () => {
    expect(parseStatuslineFieldArguments("balance credits limit_remaining").fields).toEqual(["provider_balance"]);
  });
});

describe("statusline field selection", () => {
  it("defaults to fields that complement the built-in footer", () => {
    expect(DEFAULT_STATUSLINE_FIELDS).toEqual([
      "repo",
      "branch",
      "git_diff_stats",
      "quota_5h",
      "quota_weekly",
      "provider_balance"
    ]);
  });

  it("toggles fields while preserving order", () => {
    const selected = toggleStatuslineField(["branch", "repo"], "quota_5h");
    expect(selected).toEqual(["branch", "repo", "quota_5h"]);
    expect(toggleStatuslineField(selected, "branch")).toEqual(["repo", "quota_5h"]);
  });

  it("normalizes persisted fields and falls back to defaults for missing or invalid data", () => {
    expect(normalizeStatuslineFields(undefined)).toEqual([...DEFAULT_STATUSLINE_FIELDS]);
    expect(normalizeStatuslineFields("branch")).toEqual([...DEFAULT_STATUSLINE_FIELDS]);
    expect(normalizeStatuslineFields([42, "nope"])).toEqual([...DEFAULT_STATUSLINE_FIELDS]);
    expect(normalizeStatuslineFields([])).toEqual([]);
    expect(normalizeStatuslineFields(["branch", "branch", "quota_5h", "nope"])).toEqual([
      "branch",
      "quota_5h"
    ]);
  });
});
