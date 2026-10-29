import { describe, expect, it } from "vitest";
import type { UsageReport } from "../src/lib/providers.js";
import { formatUsageReport } from "../src/lib/usage-format.js";

const report: UsageReport = {
  ok: true,
  providerID: "openrouter",
  providerName: "OpenRouter",
  generatedAtMs: new Date(2026, 0, 2, 3, 4, 5).getTime(),
  windows: [],
  balances: [],
  items: [],
  stale: true
};

describe("usage report formatting", () => {
  it("shows the last update and stale cache state", () => {
    const text = formatUsageReport(report);

    expect(text).toContain("Updated: 2026-01-02 03:04:05");
    expect(text).toContain("Cache: stale (last successful read)");
  });
});
