import { isRecord, toFiniteNumber, toNonEmptyString } from "../format.js";
import { baseReport, errorReport, fetchJson, formatCreditAmount, USER_AGENT, windowFromUsage } from "./shared.js";
import type { AdapterInput, ProviderAdapter, UsageReport, UsageWindowKey } from "./types.js";

const AUTH = { type: "env" as const, label: "XIAOMI_MIMO_SESSION_COOKIE" };

function usageItems(data: Record<string, unknown>, key: "usage" | "monthUsage"): Record<string, unknown>[] {
  const section = isRecord(data[key]) ? data[key] : undefined;
  return Array.isArray(section?.items) ? section.items.filter(isRecord) : [];
}

function findUsageItem(items: readonly Record<string, unknown>[], name: string): Record<string, unknown> | undefined {
  return items.find((item) => item.name === name);
}

function addWindow(
  report: UsageReport,
  item: Record<string, unknown> | undefined,
  key: UsageWindowKey,
  label: string
): void {
  if (!item) return;
  const used = toFiniteNumber(item.used);
  const total = toFiniteNumber(item.limit);
  const usedPercent = toFiniteNumber(item.percent);
  if (used === undefined && total === undefined && usedPercent === undefined) return;
  report.windows.push(windowFromUsage({ key, label, used, total, usedPercent, unit: "credits" }));
}

async function collectXiaomi(input: AdapterInput): Promise<UsageReport> {
  const cookie = toNonEmptyString(process.env.XIAOMI_MIMO_SESSION_COOKIE);
  if (!cookie) {
    return errorReport({
      ...input,
      error: "XIAOMI_MIMO_SESSION_COOKIE is required for Xiaomi MiMo Token Plan usage; Xiaomi rejects the tp-* API key on this endpoint"
    });
  }

  try {
    const payload = await fetchJson("https://platform.xiaomimimo.com/api/v1/tokenPlan/usage", {
      headers: {
        Accept: "application/json",
        Cookie: cookie,
        "User-Agent": USER_AGENT
      }
    });
    if (!isRecord(payload)) throw new Error("Unexpected response shape");
    const code = toFiniteNumber(payload.code);
    if (code !== undefined && code !== 0) throw new Error(toNonEmptyString(payload.message) ?? `code ${code}`);
    const data = isRecord(payload.data) ? payload.data : {};

    const report = baseReport({ ...input, auth: AUTH });
    report.plan = "Xiaomi MiMo Token Plan";

    const planItems = usageItems(data, "usage");
    const monthItems = usageItems(data, "monthUsage");
    const plan = findUsageItem(planItems, "plan_total_token");
    const compensation = findUsageItem(planItems, "compensation_total_token");
    const monthly = findUsageItem(monthItems, "month_total_token");

    addWindow(report, plan, "other", "Plan quota");
    addWindow(report, compensation, "other", "Compensation quota");
    addWindow(report, monthly, "monthly", "Monthly quota");

    const planUsed = toFiniteNumber(plan?.used);
    const planLimit = toFiniteNumber(plan?.limit);
    if (planUsed !== undefined && planLimit !== undefined && planLimit >= planUsed) {
      const remaining = planLimit - planUsed;
      report.balances.push({
        label: "Credits remaining",
        value: `${formatCreditAmount(remaining) ?? String(remaining)} credits`
      });
    }

    if (report.windows.length === 0 && report.balances.length === 0) throw new Error("No usage rows found in response");
    return report;
  } catch (err) {
    return errorReport({
      ...input,
      auth: AUTH,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export const xiaomiAdapter: ProviderAdapter = {
  id: "xiaomi-mimo",
  aliases: [
    "mimo",
    "mimo-token-plan",
    "xiaomi",
    "xiaomi-mimo",
    "xiaomi-token-plan",
    "xiaomi-token-plan-cn",
    "xiaomi-token-plan-sgp",
    "xiaomi-token-plan-ams",
    "xiaomi-mimo-token-plan",
    "xiaomi-mimo-token-plan-cn",
    "xiaomi-mimo-token-plan-sgp",
    "xiaomi-mimo-token-plan-ams"
  ],
  integrationIDs: [
    "mimo",
    "mimo-token-plan",
    "xiaomi",
    "xiaomi-mimo",
    "xiaomi-token-plan",
    "xiaomi-token-plan-cn",
    "xiaomi-token-plan-sgp",
    "xiaomi-token-plan-ams",
    "xiaomi-mimo-token-plan",
    "xiaomi-mimo-token-plan-cn",
    "xiaomi-mimo-token-plan-sgp",
    "xiaomi-mimo-token-plan-ams"
  ],
  env: ["XIAOMI_MIMO_SESSION_COOKIE"],
  credential: "none",
  collect: collectXiaomi
};
