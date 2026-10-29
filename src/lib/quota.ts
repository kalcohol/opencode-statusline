import type { CredentialEntry, LocationRef, UsageLimitsInfo } from "@opencode/client";
import type { Context } from "@opencode/plugin/tui/context";
import { credentialFingerprint } from "./credentials.js";
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

type BuiltinGoResult = {
  report?: UsageReport;
  status: "ok" | "no-data" | "error";
};

const BUILTIN_CACHE_TTL_MS = 30_000;
const BUILTIN_STALE_TTL_MS = 5 * 60_000;
const builtinCache = new Map<string, { expiresAt: number; staleUntil: number; report: UsageReport }>();
const builtinInflight = new Map<string, Promise<BuiltinGoResult>>();

export function clearQuotaCaches(): void {
  builtinCache.clear();
  builtinInflight.clear();
}

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

function builtinCacheKey(target: QuotaTarget, consoleScope: string): string {
  return [
    target.location?.directory ?? "",
    target.providerID.toLowerCase(),
    target.providerInfo?.integrationID ?? "",
    consoleScope
  ].join(":");
}

async function loadBuiltinGoReport(
  context: Context,
  target: QuotaTarget,
  options: { force?: boolean },
  consoleScope: string
): Promise<BuiltinGoResult> {
  const key = builtinCacheKey(target, consoleScope);
  const cached = builtinCache.get(key);
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return { report: cached.report, status: "ok" };
  }
  const pending = builtinInflight.get(key);
  if (!options.force && pending) return pending;

  const promise = (async (): Promise<BuiltinGoResult> => {
    try {
      const result = await context.client.experimental.usage.limits(
        target.location ? { location: target.location } : undefined
      );
      const info = result.data;
      if (!info) return { status: "no-data" };
      const report = goReport({ target, info });
      if (!report) return { status: "no-data" };
      const now = Date.now();
      if (builtinCache.size > 100) {
        for (const [cachedKey, entry] of builtinCache) {
          if (entry.staleUntil <= now) builtinCache.delete(cachedKey);
        }
      }
      builtinCache.set(key, {
        expiresAt: now + BUILTIN_CACHE_TTL_MS,
        staleUntil: now + BUILTIN_STALE_TTL_MS,
        report
      });
      return { report, status: "ok" };
    } catch {
      if (cached && cached.staleUntil > Date.now()) {
        return { report: { ...cached.report, stale: true }, status: "error" };
      }
      return { status: "error" };
    }
  })();

  builtinInflight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (builtinInflight.get(key) === promise) builtinInflight.delete(key);
  }
}

async function loadCredentials(context: Context): Promise<readonly CredentialEntry[]> {
  try {
    return await context.client.credential.list();
  } catch {
    return [];
  }
}

function goFallbackMessage(status: BuiltinGoResult["status"]): string {
  return status === "no-data"
    ? "OpenCode Console has no Go allowance for this workspace, and no direct Go API key is configured"
    : "OpenCode Console Go usage is unavailable, and no direct Go API key is configured";
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

  let providerInfo = target.providerInfo;
  let builtinStatus: BuiltinGoResult["status"] | undefined;
  const credentials = await loadCredentials(context);

  if (isOpenCodeGo(target.providerID) && target.providerInfo?.integrationID === "opencode") {
    const consoleScope = credentialFingerprint(
      credentials.filter((entry) => entry.integrationID === "opencode")
    );
    const builtin = await loadBuiltinGoReport(
      context,
      { ...target, providerName },
      options,
      consoleScope
    );
    if (builtin.report) return builtin.report;
    builtinStatus = builtin.status;
    // Fallback may use a direct Go key, but never the Console credential.
    providerInfo = { ...target.providerInfo, integrationID: "opencode-go" };
  }

  const input = {
    providerID: target.providerID,
    providerName,
    modelID: target.modelID,
    providerInfo,
    credentials,
    force: options.force
  };
  const report = await collectProviderUsage(input);
  if (!report.ok && !options.force) {
    const stale = readCachedProviderUsage(input, { allowStale: true });
    if (stale?.ok) return stale;
  }
  if (!report.ok && builtinStatus && report.error?.includes("No usable credential")) {
    return { ...report, error: goFallbackMessage(builtinStatus) };
  }
  return report;
}
