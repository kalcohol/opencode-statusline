import { createHash } from "node:crypto";
import {
  credentialFingerprint,
  describeCredentialSource,
  resolveApiCredential,
  resolveOAuthCredential,
  type CredentialSet,
  type CredentialSource
} from "./credentials.js";
import {
  clampPercent,
  formatMoney,
  isRecord,
  toFiniteNumber,
  toNonEmptyString,
  truncateText,
  usedPercentFromRemaining
} from "./format.js";

export type UsageWindowKey = "fiveHour" | "daily" | "weekly" | "monthly" | "codeReview" | "other";

export type UsageWindow = {
  key: UsageWindowKey;
  label: string;
  used?: number;
  total?: number;
  unit?: string;
  usedPercent?: number;
  remainingPercent?: number;
  resetAtMs?: number;
  resetAfterMs?: number;
};

export type UsageBalance = {
  label: string;
  value: string;
};

export type UsageItem = {
  label: string;
  value: string;
};

export type UsageReport = {
  ok: boolean;
  providerID: string;
  providerName?: string;
  modelID?: string;
  generatedAtMs: number;
  auth?: string;
  plan?: string;
  windows: UsageWindow[];
  balances: UsageBalance[];
  items: UsageItem[];
  error?: string;
};

export type ProviderInfoLike = {
  id?: string;
  name?: string;
  integrationID?: string;
};

type ProviderKind =
  | "zai"
  | "zhipu"
  | "kimi"
  | "minimax"
  | "minimax-cn"
  | "xiaomi-mimo"
  | "deepseek"
  | "opencode-go"
  | "openrouter"
  | "opencode-zen"
  | "openai-oauth"
  | "unknown";

const USER_AGENT = "OpenCode-Statusline/0.2";
const DEFAULT_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 30_000;
const CACHE_STALE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { expiresAt: number; staleUntil: number; report: UsageReport }>();
const inflight = new Map<string, Promise<UsageReport>>();
const CREDENTIAL_ENV_KEYS = [
  "ZAI_API_KEY",
  "ZAI_CODING_PLAN_API_KEY",
  "ZHIPU_API_KEY",
  "ZHIPU_CODING_PLAN_API_KEY",
  "KIMI_API_KEY",
  "KIMI_CODE_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CODING_PLAN_API_KEY",
  "MINIMAX_CHINA_CODING_PLAN_API_KEY",
  "XIAOMI_MIMO_SESSION_COOKIE",
  "DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENCODE_API_KEY"
] as const;

export type CollectProviderUsageInput = {
  providerID: string;
  providerName?: string;
  modelID?: string;
  providerInfo?: ProviderInfoLike;
  credentials?: CredentialSet;
  force?: boolean;
};

function baseReport(input: {
  providerID: string;
  providerName?: string;
  modelID?: string;
  auth?: CredentialSource;
}): UsageReport {
  return {
    ok: true,
    providerID: input.providerID,
    providerName: input.providerName,
    modelID: input.modelID,
    generatedAtMs: Date.now(),
    auth: describeCredentialSource(input.auth),
    windows: [],
    balances: [],
    items: []
  };
}

function errorReport(input: {
  providerID: string;
  providerName?: string;
  modelID?: string;
  auth?: CredentialSource;
  error: string;
}): UsageReport {
  return {
    ...baseReport(input),
    ok: false,
    error: truncateText(input.error, 220)
  };
}

function providerKind(providerID: string): ProviderKind {
  const id = providerID.toLowerCase();
  if (["zai", "zai-coding-plan"].includes(id)) return "zai";
  if (["zhipu", "zhipuai", "zhipu-coding-plan", "zhipuai-coding-plan"].includes(id)) return "zhipu";
  if (["kimi", "kimi-code", "kimi-for-coding"].includes(id)) return "kimi";
  if (["minimax", "minimax-coding-plan"].includes(id)) return "minimax";
  if (["minimax-cn", "minimax-china", "minimax-china-coding-plan", "minimax-cn-coding-plan"].includes(id)) return "minimax-cn";
  if ([
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
  ].includes(id)) return "xiaomi-mimo";
  if (id === "deepseek") return "deepseek";
  if (["opencode-go", "opencodego"].includes(id)) return "opencode-go";
  if (id === "openrouter") return "openrouter";
  if (id === "opencode") return "opencode-zen";
  if (["openai", "codex", "chatgpt"].includes(id)) return "openai-oauth";
  return "unknown";
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function credentialScope(input: CollectProviderUsageInput): string {
  return hashText(JSON.stringify({
    credentials: credentialFingerprint(input.credentials),
    env: CREDENTIAL_ENV_KEYS.map((key) => [key, process.env[key] ?? ""]),
    integrationID: input.providerInfo?.integrationID ?? ""
  }));
}

function providerUsageCacheKey(input: CollectProviderUsageInput): string {
  const kind = providerKind(input.providerID);
  const providerScope = kind === "unknown" ? input.providerID.toLowerCase() : "";
  const modelScope = kind === "minimax" || kind === "minimax-cn" ? input.modelID ?? "" : "";
  return `${kind}:${providerScope}:${modelScope}:${credentialScope(input)}`;
}

function resolveProviderApiCredential(
  input: { credentials?: CredentialSet; providerInfo?: ProviderInfoLike },
  env: readonly string[],
  providerIDs: readonly string[],
  authKeys: readonly string[] = []
) {
  const allowed = [...providerIDs, ...authKeys];
  const integrationID = input.providerInfo?.integrationID;
  if (integrationID && !allowed.includes(integrationID)) return undefined;
  return resolveApiCredential({
    env,
    credentials: input.credentials,
    integrationIDs: [
      ...(integrationID ? [integrationID] : []),
      ...allowed
    ].filter((id): id is string => Boolean(id))
  });
}

function reportForInput(report: UsageReport, input: CollectProviderUsageInput): UsageReport {
  return {
    ...report,
    providerID: input.providerID,
    providerName: input.providerName ?? report.providerName,
    modelID: input.modelID
  };
}

export function readCachedProviderUsage(
  input: CollectProviderUsageInput,
  options: { allowStale?: boolean } = {}
): UsageReport | undefined {
  const cached = cache.get(providerUsageCacheKey(input));
  if (!cached) return undefined;
  const now = Date.now();
  if (cached.expiresAt > now || (options.allowStale && cached.staleUntil > now)) {
    return reportForInput(cached.report, input);
  }
  return undefined;
}

export function clearProviderUsageCache(): void {
  cache.clear();
  inflight.clear();
}

function credentialMissing(providerID: string, providerName: string | undefined, modelID: string | undefined): UsageReport {
  return errorReport({
    providerID,
    providerName,
    modelID,
    error: "No usable credential found in the V2 credential store or environment"
  });
}

async function fetchBodyWithTimeout<Value>(
  url: string,
  init: RequestInit,
  read: (response: Response) => Promise<Value>,
  timeoutMs: number
): Promise<Value> {
  const controller = new AbortController();
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Request timed out after ${timeoutMs}ms`);
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  const request = (async () => {
    const response = await fetch(url, { ...init, signal });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${truncateText(body, 160)}`);
    }
    return read(response);
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function fetchJsonWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  return fetchBodyWithTimeout(url, init, (response) => response.json(), timeoutMs);
}

const fetchJson = fetchJsonWithTimeout;

function windowFromUsage(input: {
  key: UsageWindowKey;
  label: string;
  used?: unknown;
  total?: unknown;
  usedPercent?: unknown;
  remainingPercent?: unknown;
  resetAtMs?: unknown;
  resetAfterMs?: unknown;
  unit?: string;
}): UsageWindow {
  const used = toFiniteNumber(input.used);
  const total = toFiniteNumber(input.total);
  let usedPercent = toFiniteNumber(input.usedPercent);
  let remainingPercent = toFiniteNumber(input.remainingPercent);
  if (usedPercent === undefined && remainingPercent !== undefined) {
    usedPercent = usedPercentFromRemaining(remainingPercent);
  }
  if (remainingPercent === undefined && usedPercent !== undefined) {
    remainingPercent = clampPercent(100 - usedPercent);
  }
  if (usedPercent === undefined && used !== undefined && total !== undefined && total > 0) {
    usedPercent = clampPercent((used / total) * 100);
    remainingPercent = clampPercent(100 - usedPercent);
  }
  return {
    key: input.key,
    label: input.label,
    used,
    total,
    usedPercent: usedPercent === undefined ? undefined : clampPercent(usedPercent),
    remainingPercent: remainingPercent === undefined ? undefined : clampPercent(remainingPercent),
    resetAtMs: toFiniteNumber(input.resetAtMs),
    resetAfterMs: toFiniteNumber(input.resetAfterMs),
    unit: input.unit
  };
}

function resetAtFromSeconds(seconds: unknown): number | undefined {
  const value = toFiniteNumber(seconds);
  return value && value > 0 ? Date.now() + value * 1000 : undefined;
}

function resetAtFromUnixSeconds(seconds: unknown): number | undefined {
  const value = toFiniteNumber(seconds);
  return value && value > 0 ? value * 1000 : undefined;
}

function resetAtFromDate(value: unknown): number | undefined {
  const raw = toNonEmptyString(value);
  if (!raw) return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : undefined;
}

function formatCreditAmount(value: unknown): string | undefined {
  const amount = toFiniteNumber(value);
  if (amount === undefined) return undefined;
  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);
  const units: Array<[string, number]> = [["T", 1_000_000_000_000], ["B", 1_000_000_000], ["M", 1_000_000], ["K", 1_000]];
  const unit = units.find(([, size]) => absolute >= size);
  if (!unit) return `${Math.round(amount)}`;
  const scaled = absolute / unit[1];
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const text = scaled
    .toFixed(digits)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "");
  return `${sign}${text}${unit[0]}`;
}

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

async function queryZaiLike(input: {
  providerID: string;
  providerName?: string;
  modelID?: string;
  credentials?: CredentialSet;
  providerInfo?: ProviderInfoLike;
  zhipu: boolean;
}): Promise<UsageReport> {
  const providerIDs = input.zhipu
    ? ["zhipu", "zhipuai", "zhipu-coding-plan", "zhipuai-coding-plan"]
    : ["zai", "zai-coding-plan"];
  const credential = resolveProviderApiCredential(
    input,
    input.zhipu
      ? ["ZHIPU_API_KEY", "ZHIPU_CODING_PLAN_API_KEY"]
      : ["ZAI_API_KEY", "ZAI_CODING_PLAN_API_KEY"],
    providerIDs,
    input.zhipu
      ? ["zhipu-coding-plan", "zhipuai-coding-plan", "zhipuai"]
      : ["zai-coding-plan", "zai"]
  );
  if (!credential) return credentialMissing(input.providerID, input.providerName, input.modelID);

  const url = input.zhipu
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
    report.plan = input.zhipu ? "Zhipu coding plan" : "Z.ai coding plan";
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

function kimiReset(value: Record<string, unknown>): { resetAtMs?: number; resetAfterMs?: number } {
  const resetAtMs = resetAtFromDate(value.reset_at ?? value.resetAt ?? value.reset_time ?? value.resetTime);
  if (resetAtMs !== undefined) return { resetAtMs };
  for (const key of ["reset_in", "resetIn", "ttl"]) {
    const seconds = toFiniteNumber(value[key]);
    if (seconds !== undefined && seconds > 0) return { resetAfterMs: seconds * 1000 };
  }
  return {};
}

function kimiWindowKey(
  duration: number | undefined,
  unit: string,
  name?: string
): UsageWindowKey {
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

async function queryKimi(input: {
  providerID: string;
  providerName?: string;
  modelID?: string;
  credentials?: CredentialSet;
  providerInfo?: ProviderInfoLike;
}): Promise<UsageReport> {
  const credential = resolveProviderApiCredential(input, ["KIMI_API_KEY", "KIMI_CODE_API_KEY"], ["kimi-for-coding", "kimi-code", "kimi"], ["kimi-for-coding", "kimi-code", "kimi"]);
  if (!credential) return credentialMissing(input.providerID, input.providerName, input.modelID);

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
      const key = kimiWindowKey(duration, unit, name);
      report.windows.push(windowFromUsage({
        key: key === "other" ? "weekly" : key,
        label: key === "fiveHour" ? "5h quota" : "Weekly quota",
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
    return errorReport({ ...input, auth: credential.source, error: err instanceof Error ? err.message : String(err) });
  }
}

async function queryMiniMax(input: {
  providerID: string;
  providerName?: string;
  modelID?: string;
  credentials?: CredentialSet;
  providerInfo?: ProviderInfoLike;
  china: boolean;
}): Promise<UsageReport> {
  const credential = resolveProviderApiCredential(
    input,
    input.china
      ? ["MINIMAX_CHINA_CODING_PLAN_API_KEY"]
      : ["MINIMAX_CODING_PLAN_API_KEY", "MINIMAX_API_KEY"],
    input.china
      ? ["minimax-china-coding-plan", "minimax-cn-coding-plan", "minimax-cn", "minimax-china"]
      : ["minimax-coding-plan", "minimax"],
    input.china
      ? ["minimax-china-coding-plan", "minimax-cn-coding-plan"]
      : ["minimax-coding-plan", "minimax"]
  );
  if (!credential) return credentialMissing(input.providerID, input.providerName, input.modelID);

  try {
    const url = input.china
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
    report.plan = input.china ? "MiniMax coding plan (China)" : "MiniMax coding plan";
    const modelName = toNonEmptyString(selected.model_name);
    if (modelName) report.items.push({ label: "Quota model", value: modelName });
    const intervalTotal = toFiniteNumber(selected.current_interval_total_count);
    const intervalRaw = toFiniteNumber(selected.current_interval_usage_count);
    const intervalUsed =
      intervalRaw === undefined
        ? undefined
        : intervalTotal !== undefined
          ? input.china
            ? Math.max(0, Math.min(intervalTotal, intervalRaw))
            : Math.max(0, intervalTotal - Math.min(intervalTotal, intervalRaw))
          : input.china
            ? intervalRaw
            : undefined;
    const weeklyTotal = toFiniteNumber(selected.current_weekly_total_count);
    const weeklyRaw = toFiniteNumber(selected.current_weekly_usage_count);
    const weeklyUsed =
      weeklyRaw === undefined
        ? undefined
        : weeklyTotal !== undefined
          ? input.china
            ? Math.max(0, Math.min(weeklyTotal, weeklyRaw))
            : Math.max(0, weeklyTotal - Math.min(weeklyTotal, weeklyRaw))
          : input.china
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
    return errorReport({ ...input, auth: credential.source, error: err instanceof Error ? err.message : String(err) });
  }
}

function mimoUsageItems(data: Record<string, unknown>, key: "usage" | "monthUsage"): Record<string, unknown>[] {
  const section = isRecord(data[key]) ? data[key] : undefined;
  return Array.isArray(section?.items) ? section.items.filter(isRecord) : [];
}

function findMimoUsageItem(items: readonly Record<string, unknown>[], name: string): Record<string, unknown> | undefined {
  return items.find((item) => item.name === name);
}

function addMimoWindow(
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

async function queryXiaomiMiMo(input: {
  providerID: string;
  providerName?: string;
  modelID?: string;
}): Promise<UsageReport> {
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

    const report = baseReport({
      ...input,
      auth: { type: "env", label: "XIAOMI_MIMO_SESSION_COOKIE" }
    });
    report.plan = "Xiaomi MiMo Token Plan";

    const planItems = mimoUsageItems(data, "usage");
    const monthItems = mimoUsageItems(data, "monthUsage");
    const plan = findMimoUsageItem(planItems, "plan_total_token");
    const compensation = findMimoUsageItem(planItems, "compensation_total_token");
    const monthly = findMimoUsageItem(monthItems, "month_total_token");

    addMimoWindow(report, plan, "other", "Plan quota");
    addMimoWindow(report, compensation, "other", "Compensation quota");
    addMimoWindow(report, monthly, "monthly", "Monthly quota");

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
    return errorReport({ ...input, auth: { type: "env", label: "XIAOMI_MIMO_SESSION_COOKIE" }, error: err instanceof Error ? err.message : String(err) });
  }
}

async function queryDeepSeek(input: {
  providerID: string;
  providerName?: string;
  modelID?: string;
  credentials?: CredentialSet;
  providerInfo?: ProviderInfoLike;
}): Promise<UsageReport> {
  const credential = resolveProviderApiCredential(input, ["DEEPSEEK_API_KEY"], ["deepseek"], ["deepseek"]);
  if (!credential) return credentialMissing(input.providerID, input.providerName, input.modelID);

  try {
    const payload = await fetchJson("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${credential.token}`, "User-Agent": USER_AGENT }
    });
    if (!isRecord(payload)) throw new Error("Unexpected response shape");
    const report = baseReport({ ...input, auth: credential.source });
    report.items.push({ label: "Available", value: String(payload.is_available === true) });
    const balances = Array.isArray(payload.balance_infos) ? payload.balance_infos : [];
    for (const raw of balances) {
      if (!isRecord(raw)) continue;
      const currency = toNonEmptyString(raw.currency)?.toUpperCase() ?? "";
      const total = toNonEmptyString(raw.total_balance);
      if (!currency || !total) continue;
      report.balances.push({ label: `${currency} balance`, value: formatMoney(total, currency) ?? `${total} ${currency}` });
      const granted = toNonEmptyString(raw.granted_balance);
      const topped = toNonEmptyString(raw.topped_up_balance);
      if (granted || topped) {
        report.items.push({ label: `${currency} split`, value: `granted ${granted ?? "0"}, topped up ${topped ?? "0"}` });
      }
    }
    if (report.balances.length === 0) throw new Error("No balance rows found");
    return report;
  } catch (err) {
    return errorReport({ ...input, auth: credential.source, error: err instanceof Error ? err.message : String(err) });
  }
}

async function queryOpenRouter(input: {
  providerID: string;
  providerName?: string;
  modelID?: string;
  credentials?: CredentialSet;
  providerInfo?: ProviderInfoLike;
}): Promise<UsageReport> {
  const credential = resolveProviderApiCredential(input, ["OPENROUTER_API_KEY"], ["openrouter"], ["openrouter"]);
  if (!credential) return credentialMissing(input.providerID, input.providerName, input.modelID);

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
    return errorReport({ ...input, auth: credential.source, error: err instanceof Error ? err.message : String(err) });
  }
}

async function queryOpenCodeGo(input: {
  providerID: string;
  providerName?: string;
  modelID?: string;
  credentials?: CredentialSet;
  providerInfo?: ProviderInfoLike;
}): Promise<UsageReport> {
  const credential = resolveProviderApiCredential(
    input,
    ["OPENCODE_API_KEY"],
    ["opencode-go", "opencodego"],
    ["opencode-go", "opencodego"]
  );
  if (!credential) return credentialMissing(input.providerID, input.providerName, input.modelID);

  try {
    const payload = await fetchJson("https://opencode.ai/zen/go/v1/usage", {
      headers: {
        Authorization: `Bearer ${credential.token}`,
        ...(credential.orgID ? { "x-opencode-org-id": credential.orgID } : {}),
        "User-Agent": USER_AGENT
      }
    });
    if (!isRecord(payload)) throw new Error("Unexpected response shape");
    const usage = isRecord(payload.usage) ? payload.usage : {};
    const report = baseReport({ ...input, auth: credential.source });
    report.plan = "OpenCode Go";

    for (const [name, key, label] of [
      ["rolling", "fiveHour", "5h quota"],
      ["weekly", "weekly", "Weekly quota"],
      ["monthly", "monthly", "Monthly quota"]
    ] as const) {
      const window = usage[name];
      if (!isRecord(window) || toFiniteNumber(window.percent) === undefined) continue;
      report.windows.push(windowFromUsage({
        key,
        label,
        usedPercent: window.percent,
        resetAtMs: resetAtFromDate(window.resetsAt)
      }));
    }
    if (report.windows.length === 0) throw new Error("No usage windows found in response");
    return report;
  } catch (err) {
    return errorReport({ ...input, auth: credential.source, error: err instanceof Error ? err.message : String(err) });
  }
}

async function queryOpenAI(input: {
  providerID: string;
  providerName?: string;
  modelID?: string;
  credentials?: CredentialSet;
  providerInfo?: ProviderInfoLike;
}): Promise<UsageReport> {
  const integrationID = input.providerInfo?.integrationID;
  const allowedIntegrationIDs = ["openai", "codex", "chatgpt"];
  if (integrationID && !allowedIntegrationIDs.includes(integrationID)) {
    return errorReport({
      ...input,
      error: `Provider integration '${integrationID}' is not an OpenAI OAuth integration`
    });
  }
  const credential = resolveOAuthCredential({
    credentials: input.credentials,
    integrationIDs: [
      ...(integrationID ? [integrationID] : []),
      ...allowedIntegrationIDs
    ]
  });
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
    if (typeof rateLimit.limit_reached === "boolean") report.items.push({ label: "Limit reached", value: String(rateLimit.limit_reached) });
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
      else if (toNonEmptyString(credits.balance)) report.balances.push({ label: "Credits", value: `$${credits.balance}` });
      if (typeof credits.has_credits === "boolean") report.items.push({ label: "Has credits", value: String(credits.has_credits) });
    }
    if (report.windows.length === 0 && report.balances.length === 0) throw new Error("No usage data found in response");
    return report;
  } catch (err) {
    return errorReport({ ...input, auth: credential.source, error: err instanceof Error ? err.message : String(err) });
  }
}

export function findUsageWindow(report: UsageReport | undefined, key: UsageWindowKey): UsageWindow | undefined {
  return report?.windows.find((window) => window.key === key);
}

export async function collectProviderUsage(input: CollectProviderUsageInput): Promise<UsageReport> {
  const kind = providerKind(input.providerID);
  const cacheKey = providerUsageCacheKey(input);
  const cached = readCachedProviderUsage(input);
  if (!input.force && cached) return cached;

  const pending = inflight.get(cacheKey);
  if (pending) return reportForInput(await pending, input);

  const promise = (async () => {
    let report: UsageReport;
    switch (kind) {
      case "zai":
        report = await queryZaiLike({ ...input, zhipu: false });
        break;
      case "zhipu":
        report = await queryZaiLike({ ...input, zhipu: true });
        break;
      case "kimi":
        report = await queryKimi(input);
        break;
      case "minimax":
        report = await queryMiniMax({ ...input, china: false });
        break;
      case "minimax-cn":
        report = await queryMiniMax({ ...input, china: true });
        break;
      case "xiaomi-mimo":
        report = await queryXiaomiMiMo(input);
        break;
      case "deepseek":
        report = await queryDeepSeek(input);
        break;
      case "opencode-go":
        report = await queryOpenCodeGo(input);
        break;
      case "openrouter":
        report = await queryOpenRouter(input);
        break;
      case "openai-oauth":
        report = await queryOpenAI(input);
        break;
      case "opencode-zen":
        report = errorReport({ ...input, error: "OpenCode Console usage is available from the built-in /usage command" });
        break;
      default:
        report = errorReport({ ...input, error: `Provider '${input.providerID}' has no supported usage collector` });
        break;
    }

    if (report.ok) {
      const now = Date.now();
      if (cache.size > 100) {
        for (const [key, entry] of cache) {
          if (entry.staleUntil <= now) cache.delete(key);
        }
      }
      cache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, staleUntil: now + CACHE_STALE_TTL_MS, report });
    }
    return report;
  })();

  inflight.set(cacheKey, promise);
  try {
    return reportForInput(await promise, input);
  } finally {
    if (inflight.get(cacheKey) === promise) inflight.delete(cacheKey);
  }
}
