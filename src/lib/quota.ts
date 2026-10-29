import type { CredentialEntry, LocationRef, UsageLimitsInfo } from "@opencode/client";
import type { Context } from "@opencode/plugin/tui/context";
import { toNonEmptyString } from "./format.js";
import {
  collectProviderUsage,
  readCachedProviderUsage,
  type ProviderInfoLike,
  type UsageReport,
  type UsageWindow
} from "./providers.js";

export type QuotaTarget = {
  location?: LocationRef;
  providerID: string;
  providerName?: string;
  modelID?: string;
  providerInfo?: ProviderInfoLike;
};

function isOpenCodeGo(providerID: string): boolean {
  return ["opencode-go", "opencodego"].includes(providerID.toLowerCase());
}

function goReport(input: {
  target: QuotaTarget;
  info: UsageLimitsInfo;
}): UsageReport | undefined {
  const go = input.info.go;
  if (!go) return undefined;
  const windows: UsageWindow[] = [
    {
      key: "fiveHour",
      label: "5h quota",
      usedPercent: go.rolling.percent,
      resetAtMs: go.rolling.resetsAt
    },
    {
      key: "weekly",
      label: "Weekly quota",
      usedPercent: go.weekly.percent,
      resetAtMs: go.weekly.resetsAt
    },
    {
      key: "monthly",
      label: "Monthly quota",
      usedPercent: go.monthly.percent,
      resetAtMs: go.monthly.resetsAt
    }
  ];
  return {
    ok: true,
    providerID: input.target.providerID,
    providerName: input.target.providerName,
    modelID: input.target.modelID,
    generatedAtMs: Date.now(),
    auth: "OpenCode Console",
    plan: "OpenCode Go",
    windows,
    balances: [],
    items: []
  };
}

async function loadBuiltinGoReport(context: Context, target: QuotaTarget): Promise<UsageReport | undefined> {
  try {
    const result = await context.client.experimental.usage.limits(
      target.location ? { location: target.location } : undefined
    );
    const info = result.data;
    if (!info) return undefined;
    return goReport({ target, info });
  } catch {
    return undefined;
  }
}

let lastCredentials: readonly CredentialEntry[] | undefined;

async function loadCredentials(context: Context): Promise<readonly CredentialEntry[]> {
  try {
    const value = await context.client.credential.list();
    lastCredentials = value;
    return value;
  } catch {
    return lastCredentials ?? [];
  }
}


export async function loadQuotaReport(
  context: Context,
  target: QuotaTarget,
  options: { force?: boolean } = {}
): Promise<UsageReport> {
  const providerName =
    toNonEmptyString(target.providerName) ??
    toNonEmptyString(target.providerInfo?.name) ??
    target.providerID;

  if (isOpenCodeGo(target.providerID)) {
    const builtin = await loadBuiltinGoReport(context, { ...target, providerName });
    if (builtin) return builtin;
  }

  const credentials = await loadCredentials(context);
  const input = {
    providerID: target.providerID,
    providerName,
    modelID: target.modelID,
    providerInfo: target.providerInfo,
    credentials,
    force: options.force
  };
  const report = await collectProviderUsage(input);
  if (!report.ok && !options.force) {
    const stale = readCachedProviderUsage(input, { allowStale: true });
    if (stale?.ok) return stale;
  }
  return report;
}
