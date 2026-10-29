import { isRecord, toFiniteNumber, toNonEmptyString } from "../format.js";
import {
  baseReport,
  errorReport,
  fetchJson,
  resetAtFromDate,
  USER_AGENT,
  windowFromUsage
} from "./shared.js";
import type { AdapterInput, ProviderAdapter, UsageReport, UsageWindowKey } from "./types.js";

function kimiReset(value: Record<string, unknown>): { resetAtMs?: number; resetAfterMs?: number } {
  const resetAtMs = resetAtFromDate(value.reset_at ?? value.resetAt ?? value.reset_time ?? value.resetTime);
  if (resetAtMs !== undefined) return { resetAtMs };
  for (const key of ["reset_in", "resetIn", "ttl"]) {
    const seconds = toFiniteNumber(value[key]);
    if (seconds !== undefined && seconds > 0) return { resetAfterMs: seconds * 1000 };
  }
  return {};
}

function kimiWindowKey(duration: number | undefined, unit: string, name?: string): UsageWindowKey {
  if ((duration === 5 && unit.includes("HOUR")) || /5\s*h/i.test(name ?? "")) return "fiveHour";
  const minutes =
    duration === undefined
      ? undefined
      : unit.includes("MINUTE")
        ? duration
        : unit.includes("HOUR")
          ? duration * 60
          : unit.includes("DAY")
            ? duration * 24 * 60
            : undefined;
  if (minutes === 300) return "fiveHour";
  if (minutes === 10_080) return "weekly";
  return "other";
}

async function collectKimi(input: AdapterInput): Promise<UsageReport> {
  const credential = input.apiCredential;
  if (!credential) {
    return errorReport({
      ...input,
      error: "No usable credential found in the V2 credential store or environment"
    });
  }

  try {
    const payload = await fetchJson("https://api.kimi.com/coding/v1/usages", {
      headers: { Authorization: `Bearer ${credential.token}`, "User-Agent": USER_AGENT }
    });
    const report = baseReport({ ...input, auth: credential.source });
    report.plan = "Kimi Code";
    const root = isRecord(payload) ? payload : {};
    const data = isRecord(root.data) ? root.data : root;
    const usage = isRecord(data.usage) ? data.usage : isRecord(root.usage) ? root.usage : undefined;
    if (usage) {
      const limit = toFiniteNumber(usage.limit);
      const used = toFiniteNumber(usage.used)
        ?? (limit !== undefined && toFiniteNumber(usage.remaining) !== undefined
          ? limit - (toFiniteNumber(usage.remaining) ?? 0)
          : undefined);
      const window = isRecord(usage.window) ? usage.window : {};
      const duration = toFiniteNumber(window.duration);
      const unit = String(window.timeUnit ?? "").toUpperCase();
      const name = toNonEmptyString(usage.name);
      const detected = kimiWindowKey(duration, unit, name);
      const key =
        detected !== "other"
          ? detected
          : /week/i.test(name ?? "")
            ? "weekly"
            : /month/i.test(name ?? "")
              ? "monthly"
              : /5\s*h/i.test(name ?? "")
                ? "fiveHour"
                : "other";
      const label = key === "fiveHour"
        ? "5h quota"
        : key === "weekly"
          ? "Weekly quota"
          : key === "monthly"
            ? "Monthly quota"
            : (name ?? "Usage");
      report.windows.push(windowFromUsage({
        key,
        label,
        used,
        total: limit,
        ...kimiReset(usage)
      }));
    }
    const limits = Array.isArray(data.limits)
      ? data.limits
      : Array.isArray(root.limits)
        ? root.limits
        : [];
    for (let index = 0; index < limits.length; index += 1) {
      const limit = limits[index];
      if (!isRecord(limit)) continue;
      const detail = isRecord(limit.detail) ? limit.detail : limit;
      const windowInfo = isRecord(limit.window) ? limit.window : {};
      const duration = toFiniteNumber(windowInfo.duration);
      const unit = String(windowInfo.timeUnit ?? "").toUpperCase();
      const labelText = toNonEmptyString(limit.name);
      const key = kimiWindowKey(duration, unit, labelText);
      const label = key === "fiveHour"
        ? "5h quota"
        : key === "weekly"
          ? "Weekly quota"
          : (labelText ?? `Limit ${index + 1}`);
      const total = toFiniteNumber(detail.limit);
      const used = toFiniteNumber(detail.used)
        ?? (total !== undefined && toFiniteNumber(detail.remaining) !== undefined
          ? total - (toFiniteNumber(detail.remaining) ?? 0)
          : undefined);
      report.windows.push(windowFromUsage({ key, label, used, total, ...kimiReset({ ...limit, ...detail }) }));
    }
    if (report.windows.length === 0) throw new Error("No usage data found in response");
    return report;
  } catch (err) {
    return errorReport({
      ...input,
      auth: credential.source,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export const kimiAdapter: ProviderAdapter = {
  id: "kimi",
  aliases: ["kimi", "kimi-code", "kimi-for-coding"],
  integrationIDs: ["kimi-for-coding", "kimi-code", "kimi"],
  env: ["KIMI_API_KEY", "KIMI_CODE_API_KEY"],
  credential: "api-key",
  collect: collectKimi
};
