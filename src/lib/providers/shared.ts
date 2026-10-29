import type { CredentialSource } from "../credentials.js";
import {
  clampPercent,
  isRecord,
  toFiniteNumber,
  toNonEmptyString,
  truncateText,
  usedPercentFromRemaining
} from "../format.js";
import type { UsageReport, UsageWindow, UsageWindowKey } from "./types.js";

export const USER_AGENT = "OpenCode-Statusline/0.2";
export const DEFAULT_TIMEOUT_MS = 12_000;

export function baseReport(input: {
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
    auth: input.auth ? `${input.auth.type}:${input.auth.label}` : undefined,
    windows: [],
    balances: [],
    items: []
  };
}

export function errorReport(input: {
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

export function credentialMissing(
  providerID: string,
  providerName: string | undefined,
  modelID: string | undefined
): UsageReport {
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

export const fetchJson = fetchJsonWithTimeout;

export function windowFromUsage(input: {
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

export function resetAtFromSeconds(seconds: unknown): number | undefined {
  const value = toFiniteNumber(seconds);
  return value && value > 0 ? Date.now() + value * 1000 : undefined;
}

export function resetAtFromUnixSeconds(seconds: unknown): number | undefined {
  const value = toFiniteNumber(seconds);
  return value && value > 0 ? value * 1000 : undefined;
}

export function resetAtFromDate(value: unknown): number | undefined {
  const raw = toNonEmptyString(value);
  if (!raw) return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : undefined;
}

export function formatCreditAmount(value: unknown): string | undefined {
  const amount = toFiniteNumber(value);
  if (amount === undefined) return undefined;
  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);
  const units: Array<[string, number]> = [
    ["T", 1_000_000_000_000],
    ["B", 1_000_000_000],
    ["M", 1_000_000],
    ["K", 1_000]
  ];
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
