import type { CredentialEntry } from "@opencode/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearProviderUsageCache,
  collectProviderUsage,
  fetchJsonWithTimeout,
  findUsageWindow
} from "../src/lib/providers.js";

const savedEnv = { ...process.env };

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function keyCredential(integrationID: string, key: string, active = true): CredentialEntry {
  return {
    id: `${integrationID}-${key}`,
    integrationID,
    label: key,
    active,
    value: { type: "key", key }
  };
}

function oauthCredential(integrationID: string, access: string): CredentialEntry {
  return {
    id: `${integrationID}-oauth`,
    integrationID,
    label: "oauth",
    active: true,
    value: {
      type: "oauth",
      methodID: "test",
      refresh: "refresh",
      access,
      expires: Date.now() + 60_000
    }
  };
}

describe("provider collection", () => {
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

  it("bounds response-body parsing with the request timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => new Promise<never>(() => undefined)
    } as unknown as Response);

    await expect(fetchJsonWithTimeout("https://example.test/stalled", {}, 20)).rejects.toThrow(
      "Request timed out after 20ms"
    );
  });

  it("shares account-level cache across models and isolates changed credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const token = new Headers(init?.headers).get("Authorization");
      return jsonResponse({ data: { limit_remaining: token === "Bearer key-a" ? 10 : 20 } });
    });

    const first = await collectProviderUsage({
      providerID: "openrouter",
      modelID: "model-a",
      credentials: [keyCredential("openrouter", "key-a")]
    });
    const sameAccount = await collectProviderUsage({
      providerID: "openrouter",
      modelID: "model-b",
      credentials: [keyCredential("openrouter", "key-a")]
    });
    const nextAccount = await collectProviderUsage({
      providerID: "openrouter",
      modelID: "model-c",
      credentials: [keyCredential("openrouter", "key-b")]
    });

    expect(first.balances[0]?.value).toBe("$10.00");
    expect(sameAccount.modelID).toBe("model-b");
    expect(nextAccount.balances[0]?.value).toBe("$20.00");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent forced refreshes for the same account", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse({ data: { limit_remaining: 10 } });
    });

    const credentials = [keyCredential("openrouter", "key-a")];
    const [first, second] = await Promise.all([
      collectProviderUsage({ providerID: "openrouter", modelID: "model-a", credentials, force: true }),
      collectProviderUsage({ providerID: "openrouter", modelID: "model-b", credentials, force: true })
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

  it("queries OpenCode Go usage with an API key", async () => {
    process.env.OPENCODE_API_KEY = "go-key";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        usage: {
          rolling: { status: "ok", percent: 12.5, resetsAt: "2026-08-19T01:00:00.000Z" },
          weekly: { status: "rate-limited", percent: 100, resetsAt: "2026-08-24T00:00:00.000Z" },
          monthly: { status: "ok", percent: 40, resetsAt: "2026-09-18T00:00:00.000Z" }
        }
      })
    );

    const report = await collectProviderUsage({ providerID: "opencode-go", force: true });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://opencode.ai/zen/go/v1/usage");
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer go-key");
    expect(report.ok).toBe(true);
    expect(report.plan).toBe("OpenCode Go");
    expect(report.auth).toBe("env:OPENCODE_API_KEY");
    expect(findUsageWindow(report, "fiveHour")).toMatchObject({
      usedPercent: 12.5,
      remainingPercent: 87.5,
      resetAtMs: Date.parse("2026-08-19T01:00:00.000Z")
    });
    expect(findUsageWindow(report, "weekly")?.usedPercent).toBe(100);
    expect(findUsageWindow(report, "monthly")?.usedPercent).toBe(40);
  });

  it("reads the OpenCode Go credential from the V2 credential store", async () => {
    delete process.env.OPENCODE_API_KEY;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        usage: {
          rolling: { status: "ok", percent: 5, resetsAt: "2026-08-19T01:00:00.000Z" }
        }
      })
    );

    const report = await collectProviderUsage({
      providerID: "opencodego",
      credentials: [keyCredential("opencode", "saved-go-key")],
      force: true
    });

    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer saved-go-key");
    expect(report.ok).toBe(true);
    expect(report.auth).toBe("credential:saved-go-key");
    expect(findUsageWindow(report, "fiveHour")?.usedPercent).toBe(5);
  });

  it("does not send an OpenCode Console OAuth token to the ChatGPT endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const report = await collectProviderUsage({
      providerID: "openai",
      credentials: [oauthCredential("opencode", "console-access")],
      force: true
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(report.ok).toBe(false);
    expect(report.error).toContain("No OpenAI OAuth credential");
  });

  it("classifies OpenAI windows by duration rather than response position", async () => {    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
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
      })
    );

    const report = await collectProviderUsage({
      providerID: "openai",
      credentials: [oauthCredential("openai", "a.b.c")],
      force: true
    });

    expect(findUsageWindow(report, "monthly")?.usedPercent).toBe(20);
    expect(findUsageWindow(report, "fiveHour")?.usedPercent).toBe(70);
    expect(findUsageWindow(report, "weekly")).toBeUndefined();
    expect(report.plan).toBe("ChatGPT Business");
  });

  it("reads Z.ai limits from the top-level response shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        limits: [{ type: "TOKENS_LIMIT", unit: 3, percentage: 25, nextResetTime: 1_000 }]
      })
    );

    const report = await collectProviderUsage({
      providerID: "zai",
      credentials: [keyCredential("zai", "zai-key")],
      force: true
    });

    expect(report.ok).toBe(true);
    expect(findUsageWindow(report, "fiveHour")?.usedPercent).toBe(25);
  });

  it("maps Kimi top-level windows and minute durations", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        usage: { limit: 100, used: 20, reset_in: 3_600 },
        limits: [
          {
            name: "5h",
            detail: { limit: 100, used: 30 },
            window: { duration: 300, timeUnit: "MINUTE" },
            reset_at: "2026-08-19T01:00:00.000Z"
          }
        ]
      })
    );

    const report = await collectProviderUsage({
      providerID: "kimi",
      credentials: [keyCredential("kimi", "kimi-key")],
      force: true
    });

    expect(report.ok).toBe(true);
    expect(findUsageWindow(report, "fiveHour")?.usedPercent).toBe(30);
    expect(findUsageWindow(report, "weekly")?.usedPercent).toBe(20);
    expect(findUsageWindow(report, "weekly")?.resetAfterMs).toBe(3_600_000);
  });

  it("uses the international endpoint for the generic MiniMax provider", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        base_resp: { status_code: 0 },
        model_remains: [
          {
            model_name: "MiniMax-M*",
            current_interval_usage_count: 10,
            current_interval_total_count: 100,
            current_weekly_usage_count: 20,
            current_weekly_total_count: 200
          }
        ]
      })
    );

    const report = await collectProviderUsage({
      providerID: "minimax",
      credentials: [keyCredential("minimax", "minimax-key")],
      force: true
    });

    expect(report.ok).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.minimax.io/v1/api/openplatform/coding_plan/remains"
    );
    expect(findUsageWindow(report, "fiveHour")?.usedPercent).toBe(90);
    expect(findUsageWindow(report, "weekly")?.usedPercent).toBe(90);
  });
});
