import type { Context } from "@opencode/plugin/tui/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearProviderUsageCache, findUsageWindow } from "../src/lib/providers.js";
import { clearQuotaCaches, loadQuotaReport } from "../src/lib/quota.js";

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
    clearQuotaCaches();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearProviderUsageCache();
    clearQuotaCaches();
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected request"));

    const report = await loadQuotaReport(
      context,
      { providerID: "opencode-go", providerInfo: { id: "opencode-go", integrationID: "opencode" } },
      { force: true }
    );

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

  it("keeps a direct Go integration on its own API key instead of Console data", async () => {
    process.env.OPENCODE_API_KEY = "go-key";
    const context = contextWith({
      limits: {
        data: {
          workspace: { id: "workspace", usageURL: "https://opencode.ai" },
          go: {
            rolling: { percent: 99, limited: false, resetsAt: 1_000 },
            weekly: { percent: 99, limited: false, resetsAt: 2_000 },
            monthly: { percent: 99, limited: false, resetsAt: 3_000 }
          },
          budgets: []
        }
      }
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        usage: {
          rolling: { status: "ok", percent: 7, resetsAt: "2026-08-19T01:00:00.000Z" }
        }
      })
    );

    const report = await loadQuotaReport(
      context,
      { providerID: "opencode-go", providerInfo: { id: "opencode-go", integrationID: "opencode-go" } },
      { force: true }
    );

    expect(context.client.experimental.usage.limits).not.toHaveBeenCalled();
    expect(report.auth).toBe("env:OPENCODE_API_KEY");
    expect(findUsageWindow(report, "fiveHour")?.usedPercent).toBe(7);
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

    const report = await loadQuotaReport(
      context,
      { providerID: "opencode-go", providerInfo: { id: "opencode-go", integrationID: "opencode" } },
      { force: true }
    );

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
    expect(second.stale).toBe(true);
    expect(second.balances[0]?.value).toBe("$10.00");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not send a Console credential to the Go fallback endpoint", async () => {
    delete process.env.OPENCODE_API_KEY;
    const context = contextWith({
      limits: { data: null },
      credentials: [
        {
          id: "console",
          integrationID: "opencode",
          label: "Console key",
          active: true,
          value: { type: "key", key: "console-key" }
        }
      ]
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected request"));

    const report = await loadQuotaReport(
      context,
      { providerID: "opencode-go", providerInfo: { id: "opencode-go", integrationID: "opencode" } },
      { force: true }
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(report.ok).toBe(false);
  });

  it("falls back to stale built-in Go usage when a refresh fails", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const limits = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          workspace: { id: "workspace", usageURL: "https://opencode.ai" },
          go: {
            rolling: { percent: 10, limited: false, resetsAt: 1_000 },
            weekly: { percent: 20, limited: false, resetsAt: 2_000 },
            monthly: { percent: 30, limited: false, resetsAt: 3_000 }
          },
          budgets: []
        }
      })
      .mockRejectedValueOnce(new Error("console down"));
    const context = {
      client: {
        experimental: { usage: { limits } },
        credential: { list: vi.fn().mockResolvedValue([]) }
      }
    } as unknown as Context;
    const target = {
      providerID: "opencode-go",
      providerInfo: { id: "opencode-go", integrationID: "opencode" }
    };

    const first = await loadQuotaReport(context, target, { force: true });
    now += 31_000;
    const second = await loadQuotaReport(context, target);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.stale).toBe(true);
    expect(findUsageWindow(second, "fiveHour")?.usedPercent).toBe(10);
  });

  it("isolates built-in Go cache by Console account metadata", async () => {
    const limits = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          workspace: { id: "workspace-a", usageURL: "https://opencode.ai" },
          go: {
            rolling: { percent: 10, limited: false, resetsAt: 1_000 },
            weekly: { percent: 20, limited: false, resetsAt: 2_000 },
            monthly: { percent: 30, limited: false, resetsAt: 3_000 }
          },
          budgets: []
        }
      })
      .mockResolvedValueOnce({
        data: {
          workspace: { id: "workspace-b", usageURL: "https://opencode.ai" },
          go: {
            rolling: { percent: 80, limited: false, resetsAt: 1_000 },
            weekly: { percent: 90, limited: false, resetsAt: 2_000 },
            monthly: { percent: 95, limited: false, resetsAt: 3_000 }
          },
          budgets: []
        }
      });
    const credentials = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "console-a",
          integrationID: "opencode",
          label: "A",
          active: true,
          value: { type: "key", key: "same-token", metadata: { orgID: "org-a" } }
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "console-a",
          integrationID: "opencode",
          label: "A",
          active: true,
          value: { type: "key", key: "same-token", metadata: { orgID: "org-b" } }
        }
      ]);
    const context = {
      client: {
        experimental: { usage: { limits } },
        credential: { list: credentials }
      }
    } as unknown as Context;
    const target = {
      providerID: "opencode-go",
      providerInfo: { id: "opencode-go", integrationID: "opencode" }
    };

    const first = await loadQuotaReport(context, target);
    const second = await loadQuotaReport(context, target);

    expect(limits).toHaveBeenCalledTimes(2);
    expect(findUsageWindow(first, "fiveHour")?.usedPercent).toBe(10);
    expect(findUsageWindow(second, "fiveHour")?.usedPercent).toBe(80);
  });

  it("distinguishes a missing Go allowance from missing credentials", async () => {
    delete process.env.OPENCODE_API_KEY;
    const context = contextWith({
      limits: { data: null },
      credentials: [
        {
          id: "console",
          integrationID: "opencode",
          label: "Console key",
          active: true,
          value: { type: "key", key: "console-key" }
        }
      ]
    });

    const report = await loadQuotaReport(
      context,
      { providerID: "opencode-go", providerInfo: { id: "opencode-go", integrationID: "opencode" } },
      { force: true }
    );

    expect(report.ok).toBe(false);
    expect(report.error).toContain("has no Go allowance");
  });

  it("caches built-in Go usage briefly", async () => {
    const context = contextWith({
      limits: {
        data: {
          workspace: { id: "workspace", usageURL: "https://opencode.ai" },
          go: {
            rolling: { percent: 10, limited: false, resetsAt: 1_000 },
            weekly: { percent: 20, limited: false, resetsAt: 2_000 },
            monthly: { percent: 30, limited: false, resetsAt: 3_000 }
          },
          budgets: []
        }
      }
    });
    const target = {
      providerID: "opencode-go",
      providerInfo: { id: "opencode-go", integrationID: "opencode" }
    };

    await loadQuotaReport(context, target);
    await loadQuotaReport(context, target);

    expect(context.client.experimental.usage.limits).toHaveBeenCalledTimes(1);
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
