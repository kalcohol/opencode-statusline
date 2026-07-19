import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearProviderUsageCache,
  collectProviderUsage,
  fetchJsonWithTimeout,
  findUsageWindow
} from "../src/lib/providers.js";

const savedEnv = { ...process.env };
let tempDir = "";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("provider collection", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-statusline-provider-"));
    process.env.OPENCODE_AUTH_JSON = path.join(tempDir, "auth.json");
    clearProviderUsageCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearProviderUsageCache();
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("bounds response-body parsing with the request timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => new Promise<never>(() => undefined)
    } as unknown as Response);

    await expect(fetchJsonWithTimeout("https://example.test/stalled", {}, 20))
      .rejects.toThrow("Request timed out after 20ms");
  });

  it("shares account-level cache across models and isolates changed credentials", async () => {
    process.env.OPENROUTER_API_KEY = "key-a";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const token = new Headers(init?.headers).get("Authorization");
      return jsonResponse({ data: { limit_remaining: token === "Bearer key-a" ? 10 : 20 } });
    });

    const first = await collectProviderUsage({ providerID: "openrouter", modelID: "model-a" });
    const sameAccount = await collectProviderUsage({ providerID: "openrouter", modelID: "model-b" });
    process.env.OPENROUTER_API_KEY = "key-b";
    const nextAccount = await collectProviderUsage({ providerID: "openrouter", modelID: "model-c" });

    expect(first.balances[0]?.value).toBe("$10.00");
    expect(sameAccount.modelID).toBe("model-b");
    expect(nextAccount.balances[0]?.value).toBe("$20.00");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent forced refreshes for the same account", async () => {
    process.env.OPENROUTER_API_KEY = "key-a";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse({ data: { limit_remaining: 10 } });
    });

    const [first, second] = await Promise.all([
      collectProviderUsage({ providerID: "openrouter", modelID: "model-a", force: true }),
      collectProviderUsage({ providerID: "openrouter", modelID: "model-b", force: true })
    ]);

    expect(first.modelID).toBe("model-a");
    expect(second.modelID).toBe("model-b");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not share cached errors between unknown providers", async () => {
    const first = await collectProviderUsage({ providerID: "custom-alpha" });
    const second = await collectProviderUsage({ providerID: "custom-beta" });

    expect(first.error).toContain("custom-alpha");
    expect(second.error).toContain("custom-beta");
  });

  it("builds credential cache keys from cyclic provider options", async () => {
    process.env.OPENROUTER_API_KEY = "key-a";
    const options: Record<string, unknown> = {};
    options.self = options;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: { limit_remaining: 10 } }));

    const report = await collectProviderUsage({
      providerID: "openrouter",
      providerInfo: { options }
    });

    expect(report.ok).toBe(true);
    expect(report.balances[0]?.value).toBe("$10.00");
  });

  it("classifies OpenAI windows by duration rather than response position", async () => {
    fs.writeFileSync(process.env.OPENCODE_AUTH_JSON!, JSON.stringify({
      openai: { type: "oauth", access: "a.b.c", expires: Date.now() + 60_000 }
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      plan_type: "business",
      rate_limit: {
        limit_reached: false,
        primary_window: {
          used_percent: 20,
          limit_window_seconds: 2_628_000,
          reset_after_seconds: 60
        },
        secondary_window: {
          used_percent: 70,
          limit_window_seconds: 18_000,
          reset_after_seconds: 30
        }
      }
    }));

    const report = await collectProviderUsage({ providerID: "openai", force: true });

    expect(findUsageWindow(report, "monthly")?.usedPercent).toBe(20);
    expect(findUsageWindow(report, "fiveHour")?.usedPercent).toBe(70);
    expect(findUsageWindow(report, "weekly")).toBeUndefined();
    expect(report.plan).toBe("ChatGPT Business");
  });

  it("uses the international endpoint for the generic MiniMax provider", async () => {
    process.env.MINIMAX_API_KEY = "minimax-key";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      base_resp: { status_code: 0 },
      model_remains: [{
        model_name: "MiniMax-M*",
        current_interval_usage_count: 10,
        current_interval_total_count: 100,
        current_weekly_usage_count: 20,
        current_weekly_total_count: 200
      }]
    }));

    const report = await collectProviderUsage({ providerID: "minimax", force: true });

    expect(report.ok).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.minimax.io/v1/api/openplatform/coding_plan/remains");
  });
});
