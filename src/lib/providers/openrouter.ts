import { isRecord, formatMoney, toFiniteNumber, toNonEmptyString } from "../format.js";
import { baseReport, errorReport, fetchJson, USER_AGENT } from "./shared.js";
import type { AdapterInput, ProviderAdapter, UsageReport } from "./types.js";

async function collectOpenRouter(input: AdapterInput): Promise<UsageReport> {
  const credential = input.apiCredential;
  if (!credential) {
    return errorReport({
      ...input,
      error: "No usable credential found in the V2 credential store or environment"
    });
  }

  try {
    const payload = await fetchJson("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${credential.token}`, "User-Agent": USER_AGENT }
    });
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
    if (!isRecord(data)) throw new Error("Unexpected response shape");
    const report = baseReport({ ...input, auth: credential.source });
    const label = toNonEmptyString(data.label);
    if (label) report.items.push({ label: "Key label", value: label });
    const limit = toFiniteNumber(data.limit);
    const remaining = toFiniteNumber(data.limit_remaining);
    if (remaining !== undefined) {
      report.balances.push({ label: "Limit remaining", value: formatMoney(remaining) ?? String(remaining) });
    }
    if (limit !== undefined) report.items.push({ label: "Limit", value: formatMoney(limit) ?? String(limit) });
    if (data.limit === null) report.items.push({ label: "Limit", value: "unlimited" });
    const limitReset = toNonEmptyString(data.limit_reset);
    if (limitReset) report.items.push({ label: "Limit reset", value: limitReset });
    for (const [labelText, key] of [
      ["Usage total", "usage"],
      ["Usage daily", "usage_daily"],
      ["Usage weekly", "usage_weekly"],
      ["Usage monthly", "usage_monthly"],
      ["BYOK usage", "byok_usage"]
    ] as const) {
      const value = formatMoney(data[key]);
      if (value) report.items.push({ label: labelText, value });
    }
    if (typeof data.is_free_tier === "boolean") report.items.push({ label: "Free tier", value: String(data.is_free_tier) });
    return report;
  } catch (err) {
    return errorReport({
      ...input,
      auth: credential.source,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export const openrouterAdapter: ProviderAdapter = {
  id: "openrouter",
  aliases: ["openrouter"],
  integrationIDs: ["openrouter"],
  env: ["OPENROUTER_API_KEY"],
  credential: "api-key",
  collect: collectOpenRouter
};
