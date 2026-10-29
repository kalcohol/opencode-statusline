import { isRecord, toFiniteNumber, toNonEmptyString } from "../format.js";
import { baseReport, errorReport, fetchJson, USER_AGENT, windowFromUsage } from "./shared.js";
import type { AdapterInput, ProviderAdapter, UsageReport } from "./types.js";

async function collectMiniMax(input: AdapterInput, china: boolean): Promise<UsageReport> {
  const credential = input.apiCredential;
  if (!credential) {
    return errorReport({
      ...input,
      error: "No usable credential found in the V2 credential store or environment"
    });
  }

  try {
    const url = china
      ? "https://api.minimaxi.com/v1/token_plan/remains"
      : "https://api.minimax.io/v1/api/openplatform/coding_plan/remains";
    const payload = await fetchJson(url, {
      headers: { Authorization: `Bearer ${credential.token}`, "User-Agent": USER_AGENT }
    });
    if (!isRecord(payload)) throw new Error("Unexpected response shape");
    const base = isRecord(payload.base_resp) ? payload.base_resp : {};
    const status = toFiniteNumber(base.status_code);
    if (status !== undefined && status !== 0) throw new Error(toNonEmptyString(base.status_msg) ?? `status_code ${status}`);
    const remains = Array.isArray(payload.model_remains) ? payload.model_remains.filter(isRecord) : [];
    const wanted = input.modelID?.trim().toLowerCase();
    const name = (item: Record<string, unknown>) =>
      (toNonEmptyString(item.model_name) ?? "").toLowerCase();
    const selected =
      remains.find((item) => name(item) === "minimax-m*")
      ?? (wanted ? remains.find((item) => name(item) === wanted) : undefined)
      ?? remains.find((item) => name(item).startsWith("minimax-m"))
      ?? remains.find((item) => name(item) === "general" || name(item) === "video")
      ?? remains[0];
    if (!selected) throw new Error("No model quota rows found");

    const report = baseReport({ ...input, auth: credential.source });
    report.plan = china ? "MiniMax coding plan (China)" : "MiniMax coding plan";
    const modelName = toNonEmptyString(selected.model_name);
    if (modelName) report.items.push({ label: "Quota model", value: modelName });
    const intervalTotal = toFiniteNumber(selected.current_interval_total_count);
    const intervalRaw = toFiniteNumber(selected.current_interval_usage_count);
    const intervalUsed =
      intervalRaw === undefined
        ? undefined
        : intervalTotal !== undefined
          ? china
            ? Math.max(0, Math.min(intervalTotal, intervalRaw))
            : Math.max(0, intervalTotal - Math.min(intervalTotal, intervalRaw))
          : china
            ? intervalRaw
            : undefined;
    const weeklyTotal = toFiniteNumber(selected.current_weekly_total_count);
    const weeklyRaw = toFiniteNumber(selected.current_weekly_usage_count);
    const weeklyUsed =
      weeklyRaw === undefined
        ? undefined
        : weeklyTotal !== undefined
          ? china
            ? Math.max(0, Math.min(weeklyTotal, weeklyRaw))
            : Math.max(0, weeklyTotal - Math.min(weeklyTotal, weeklyRaw))
          : china
            ? weeklyRaw
            : undefined;
    if (
      intervalTotal !== undefined ||
      intervalRaw !== undefined ||
      toFiniteNumber(selected.remains_time) !== undefined
    ) {
      report.windows.push(windowFromUsage({
        key: "fiveHour",
        label: "5h quota",
        used: intervalUsed,
        total: intervalTotal,
        resetAfterMs: selected.remains_time
      }));
    }
    if (
      weeklyTotal !== undefined ||
      weeklyRaw !== undefined ||
      toFiniteNumber(selected.weekly_remains_time) !== undefined
    ) {
      report.windows.push(windowFromUsage({
        key: "weekly",
        label: "Weekly quota",
        used: weeklyUsed,
        total: weeklyTotal,
        resetAfterMs: selected.weekly_remains_time
      }));
    }
    if (report.windows.length === 0) throw new Error("No quota windows found in response");
    return report;
  } catch (err) {
    return errorReport({
      ...input,
      auth: credential.source,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export const minimaxAdapter: ProviderAdapter = {
  id: "minimax",
  aliases: ["minimax", "minimax-coding-plan"],
  integrationIDs: ["minimax-coding-plan", "minimax"],
  env: ["MINIMAX_CODING_PLAN_API_KEY", "MINIMAX_API_KEY"],
  credential: "api-key",
  cacheScope: "account+model",
  collect: (input) => collectMiniMax(input, false)
};

export const minimaxChinaAdapter: ProviderAdapter = {
  id: "minimax-cn",
  aliases: ["minimax-cn", "minimax-china", "minimax-china-coding-plan", "minimax-cn-coding-plan"],
  integrationIDs: [
    "minimax-china-coding-plan",
    "minimax-cn-coding-plan",
    "minimax-cn",
    "minimax-china"
  ],
  env: ["MINIMAX_CHINA_CODING_PLAN_API_KEY"],
  credential: "api-key",
  cacheScope: "account+model",
  collect: (input) => collectMiniMax(input, true)
};
