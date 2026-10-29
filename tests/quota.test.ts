import type { Context } from "@opencode/plugin/tui/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearProviderUsageCache, findUsageWindow } from "../src/lib/providers.js";
import { loadQuotaReport } from "../src/lib/quota.js";

const savedEnv = { ...process.env };

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function contextWith(input: {
  limits?: unknown;
  credentials?: unknown[];
}): Context {  return {
    client: {
      experimental: {
        usage: {
          limits: vi.fn().mockResolvedValue(input.limits)
        }
      },
      credential: {
        list: vi.fn().mockResolvedValue(input.credentials ?? [])
      }
    }
  } as unknown as Context;
}

describe("quota loading", () => {
  beforeEach(() => {
    clearProviderUsageCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearProviderUsageCache();
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
  });

  it("reuses the built-in Go usage when Console exposes it", async () => {
    const context = contextWith({
      limits: {
        data: {
          workspace: { id: "workspace", usageURL: "https://opencode.ai" },
          go: {
            rolling: { percent: 12, limited: false, resetsAt: 1_000 },
            weekly: { percent: 34, limited: false, resetsAt: 2_000 },
            monthly: { percent: 56, limited: true, resetsAt: 3_000 }
          },
          budgets: []
        }
      }
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const report = await loadQuotaReport(context, { providerID: "opencode-go" }, { force: true });

    expect(context.client.experimental.usage.limits).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(report.ok).toBe(true);
    expect(report.plan).toBe("OpenCode Go");
    expect(report.auth).toBe("OpenCode Console");
    expect(findUsageWindow(report, "fiveHour")).toMatchObject({
      usedPercent: 12,
      resetAtMs: 1_000
    });
    expect(findUsageWindow(report, "weekly")?.usedPercent).toBe(34);
    expect(findUsageWindow(report, "monthly")?.usedPercent).toBe(56);
  });

  it("falls back to the API-key collector when Console has no Go data", async () => {
    process.env.OPENCODE_API_KEY = "go-key";
    const context = contextWith({ limits: { data: null } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: {
            rolling: { status: "ok", percent: 7, resetsAt: "2026-08-19T01:00:00.000Z" }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const report = await loadQuotaReport(context, { providerID: "opencode-go" }, { force: true });

    expect(report.ok).toBe(true);
    expect(report.auth).toBe("env:OPENCODE_API_KEY");
    expect(findUsageWindow(report, "fiveHour")?.usedPercent).toBe(7);
  });

  it("returns the last good quota when a refresh fails", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    process.env.OPENROUTER_API_KEY = "key";
    const context = contextWith({ limits: { data: null } });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { limit_remaining: 10 } }))
      .mockRejectedValueOnce(new Error("network down"));

    const first = await loadQuotaReport(context, { providerID: "openrouter" }, { force: true });
    now += 31_000;
    const second = await loadQuotaReport(context, { providerID: "openrouter" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.balances[0]?.value).toBe("$10.00");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not call the built-in Go endpoint for other providers", async () => {
    process.env.OPENROUTER_API_KEY = "key";
    const context = contextWith({ limits: { data: null } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { limit_remaining: 10 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await loadQuotaReport(context, { providerID: "openrouter" }, { force: true });

    expect(context.client.experimental.usage.limits).not.toHaveBeenCalled();
  });
});
