import { isRecord, toFiniteNumber, toNonEmptyString } from "../format.js";
import { baseReport, errorReport, fetchJson, USER_AGENT, windowFromUsage } from "./shared.js";
import type { AdapterInput, ProviderAdapter, UsageReport } from "./types.js";

async function collectZaiLike(input: AdapterInput, zhipu: boolean): Promise<UsageReport> {
  const credential = input.apiCredential;
  if (!credential) {
    return errorReport({
      ...input,
      error: "No usable credential found in the V2 credential store or environment"
    });
  }

  const url = zhipu
    ? "https://bigmodel.cn/api/monitor/usage/quota/limit"
    : "https://api.z.ai/api/monitor/usage/quota/limit";
  try {
    const payload = await fetchJson(url, {
      headers: {
        Authorization: credential.token,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT
      }
    });
    const report = baseReport({ ...input, auth: credential.source });
    report.plan = zhipu ? "Zhipu coding plan" : "Z.ai coding plan";
    if (isRecord(payload)) {
      const code = toFiniteNumber(payload.code);
      if (payload.success === false || (code !== undefined && code >= 400)) {
        const message = toNonEmptyString(payload.msg) ?? toNonEmptyString(payload.message);
        throw new Error(message ?? (code !== undefined ? `API error ${code}` : "API error"));
      }
    }
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
    const limits = Array.isArray(data.limits)
      ? data.limits
      : isRecord(payload) && Array.isArray(payload.limits)
        ? payload.limits
        : [];
    let tokenWindowCount = 0;
    for (const raw of limits) {
      if (!isRecord(raw)) continue;
      const type = toNonEmptyString(raw.type);
      const unit = toFiniteNumber(raw.unit);
      const percentage = toFiniteNumber(raw.percentage);
      const resetAtMs = toFiniteNumber(raw.nextResetTime);
      if (percentage === undefined) continue;
      if (type === "TOKENS_LIMIT") {
        tokenWindowCount += 1;
        if (unit === 6) {
          report.windows.push(windowFromUsage({ key: "weekly", label: "Weekly quota", usedPercent: percentage, resetAtMs }));
        } else if (unit === 4) {
          report.windows.push(windowFromUsage({ key: "daily", label: "Daily quota", usedPercent: percentage, resetAtMs }));
        } else {
          const key = unit === 3 || tokenWindowCount === 1 ? "fiveHour" : "other";
          const label = key === "fiveHour" ? "5h quota" : `Token quota${unit ? ` unit ${unit}` : ""}`;
          report.windows.push(windowFromUsage({ key, label, usedPercent: percentage, resetAtMs }));
        }
      } else if (type === "TIME_LIMIT") {
        report.windows.push(windowFromUsage({
          key: "monthly",
          label: "Monthly time quota",
          used: raw.currentValue,
          total: raw.usage,
          usedPercent: percentage,
          resetAtMs,
          unit: "time"
        }));
      }
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

export const zaiAdapter: ProviderAdapter = {
  id: "zai",
  aliases: ["zai", "zai-coding-plan"],
  integrationIDs: ["zai", "zai-coding-plan"],
  env: ["ZAI_API_KEY", "ZAI_CODING_PLAN_API_KEY"],
  credential: "api-key",
  collect: (input) => collectZaiLike(input, false)
};

export const zhipuAdapter: ProviderAdapter = {
  id: "zhipu",
  aliases: ["zhipu", "zhipuai", "zhipu-coding-plan", "zhipuai-coding-plan"],
  integrationIDs: ["zhipu", "zhipuai", "zhipu-coding-plan", "zhipuai-coding-plan"],
  env: ["ZHIPU_API_KEY", "ZHIPU_CODING_PLAN_API_KEY"],
  credential: "api-key",
  collect: (input) => collectZaiLike(input, true)
};
