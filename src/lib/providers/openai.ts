import { formatMoney, isRecord, toFiniteNumber, toNonEmptyString } from "../format.js";
import {
  baseReport,
  errorReport,
  fetchJson,
  resetAtFromSeconds,
  resetAtFromUnixSeconds,
  USER_AGENT,
  windowFromUsage
} from "./shared.js";
import type { AdapterInput, ProviderAdapter, UsageReport, UsageWindow, UsageWindowKey } from "./types.js";

function parseJwtPayload(token: string): Record<string, unknown> | undefined {
  try {
    const [, payload] = token.split(".");
    if (!payload) return undefined;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const parsed: unknown = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function openAIAccountID(access: string, explicit?: string): string | undefined {
  if (explicit) return explicit;
  const payload = parseJwtPayload(access);
  const auth = payload?.["https://api.openai.com/auth"];
  if (isRecord(auth)) return toNonEmptyString(auth.chatgpt_account_id);
  return toNonEmptyString(payload?.["https://api.openai.com/auth.chatgpt_account_id"]);
}

function openAIEmail(access: string): string | undefined {
  const payload = parseJwtPayload(access);
  const profile = payload?.["https://api.openai.com/profile"];
  if (isRecord(profile)) return toNonEmptyString(profile.email);
  return toNonEmptyString(payload?.["https://api.openai.com/profile.email"]);
}

async function collectOpenAI(input: AdapterInput): Promise<UsageReport> {
  const credential = input.oauth;
  if (!credential) {
    return errorReport({
      ...input,
      error: "No OpenAI OAuth credential found"
    });
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${credential.access}`,
      "User-Agent": USER_AGENT
    };
    const accountID = openAIAccountID(credential.access, credential.accountId);
    if (accountID) headers["ChatGPT-Account-Id"] = accountID;
    const payload = await fetchJson("https://chatgpt.com/backend-api/wham/usage", { headers });
    if (!isRecord(payload)) throw new Error("Unexpected response shape");
    const report = baseReport({ ...input, auth: credential.source });
    const planType = toNonEmptyString(payload.plan_type);
    const normalizedPlan = planType?.toLowerCase();
    report.plan = normalizedPlan === "team" || normalizedPlan === "business"
      ? "ChatGPT Business"
      : normalizedPlan?.includes("pro")
        ? "ChatGPT Pro"
        : normalizedPlan?.includes("plus")
          ? "ChatGPT Plus"
          : (planType ?? "ChatGPT");
    const email = openAIEmail(credential.access);
    if (email) report.items.push({ label: "Account", value: email });
    const rateLimit = isRecord(payload.rate_limit) ? payload.rate_limit : {};
    const primary = isRecord(rateLimit.primary_window) ? rateLimit.primary_window : undefined;
    const secondary = isRecord(rateLimit.secondary_window) ? rateLimit.secondary_window : undefined;
    if (typeof rateLimit.limit_reached === "boolean") {
      report.items.push({ label: "Limit reached", value: String(rateLimit.limit_reached) });
    }
    const windows = new Map<UsageWindowKey, { window: UsageWindow; conflict: boolean; resetKey: string }>();
    for (const [window, fallbackKey] of [[primary, "fiveHour"], [secondary, "weekly"]] as const) {
      if (!window) continue;
      const usedPercent = toFiniteNumber(window.used_percent);
      if (usedPercent === undefined) continue;
      const duration = toFiniteNumber(window.limit_window_seconds);
      const key: UsageWindowKey | undefined = duration === undefined
        ? fallbackKey
        : duration === 18_000
          ? "fiveHour"
          : duration === 604_800
            ? "weekly"
            : duration === 2_628_000
              ? "monthly"
              : undefined;
      if (!key) continue;
      const label = key === "fiveHour" ? "5h quota" : key === "weekly" ? "Weekly quota" : "Monthly quota";
      const resetAt = toFiniteNumber(window.reset_at);
      const resetAfter = toFiniteNumber(window.reset_after_seconds);
      const resetKey = `${resetAt ?? ""}:${resetAfter ?? ""}`;
      const next = windowFromUsage({
        key,
        label,
        usedPercent,
        resetAtMs: resetAtFromUnixSeconds(resetAt) ?? resetAtFromSeconds(resetAfter)
      });
      const prior = windows.get(key);
      if (!prior) windows.set(key, { window: next, conflict: false, resetKey });
      else if (prior.window.usedPercent !== usedPercent || prior.resetKey !== resetKey) {
        windows.set(key, { ...prior, conflict: true });
      }
    }
    for (const entry of windows.values()) {
      if (!entry.conflict) report.windows.push(entry.window);
    }
    const codeReviewRoot = isRecord(payload.code_review_rate_limit) ? payload.code_review_rate_limit : {};
    const codeReview = isRecord(codeReviewRoot.primary_window) ? codeReviewRoot.primary_window : undefined;
    const codeReviewPercent = codeReview ? toFiniteNumber(codeReview.used_percent) : undefined;
    if (codeReview && codeReviewPercent !== undefined) {
      report.windows.push(windowFromUsage({
        key: "codeReview",
        label: "Code review quota",
        usedPercent: codeReviewPercent,
        resetAtMs: resetAtFromUnixSeconds(codeReview.reset_at) ?? resetAtFromSeconds(codeReview.reset_after_seconds)
      }));
    }
    const credits = isRecord(payload.credits) ? payload.credits : undefined;
    if (credits) {
      if (credits.unlimited === true) report.balances.push({ label: "Credits", value: "unlimited" });
      else {
        const balance = formatMoney(credits.balance);
        if (balance) report.balances.push({ label: "Credits", value: balance });
      }
      if (typeof credits.has_credits === "boolean") report.items.push({ label: "Has credits", value: String(credits.has_credits) });
    }
    if (report.windows.length === 0 && report.balances.length === 0) throw new Error("No usage data found in response");
    return report;
  } catch (err) {
    return errorReport({
      ...input,
      auth: credential.source,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  aliases: ["openai", "codex", "chatgpt"],
  integrationIDs: ["openai", "codex", "chatgpt"],
  env: [],
  credential: "oauth",
  missingCredentialError: "No OpenAI OAuth credential found",
  collect: collectOpenAI
};
