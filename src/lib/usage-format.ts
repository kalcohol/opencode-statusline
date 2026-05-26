import { describeCredentialSource } from "./auth.js";
import {
  formatPercent,
  formatReset,
  sanitizeDisplayText,
  toNonEmptyString
} from "./format.js";
import type { UsageReport, UsageWindow } from "./providers.js";

function formatWindow(window: UsageWindow): string {
  const parts: string[] = [];
  if (window.usedPercent !== undefined) parts.push(`${formatPercent(window.usedPercent)} used`);
  if (window.remainingPercent !== undefined) parts.push(`${formatPercent(window.remainingPercent)} left`);
  if (window.used !== undefined && window.total !== undefined) parts.push(`${window.used}/${window.total}`);
  else if (window.used !== undefined) parts.push(`used ${window.used}`);
  else if (window.total !== undefined) parts.push(`limit ${window.total}`);
  const reset = formatReset(window);
  if (reset) parts.push(`reset ${reset}`);
  return `${window.label}: ${parts.join(", ") || "available"}`;
}

export function formatUsageReport(report: UsageReport | undefined): string {
  if (!report) {
    return [
      "Usage unavailable",
      "",
      "Could not resolve the current provider/model for this session. Send one model request first or set config.model."
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push("OpenCode Usage");
  lines.push("");
  lines.push(`Provider: ${report.providerName ? `${report.providerName} (${report.providerID})` : report.providerID}`);
  if (report.modelID) lines.push(`Model: ${report.modelID}`);
  if (report.auth) lines.push(`Auth: ${report.auth}`);
  if (report.plan) lines.push(`Plan: ${report.plan}`);
  if (!report.ok && report.error) lines.push(`Status: ${report.error}`);

  if (report.balances.length) {
    lines.push("");
    for (const balance of report.balances) lines.push(`${balance.label}: ${balance.value}`);
  }

  if (report.windows.length) {
    lines.push("");
    const order = ["fiveHour", "daily", "weekly", "monthly", "codeReview", "other"];
    const windows = [...report.windows].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    for (const window of windows) lines.push(formatWindow(window));
  }

  if (report.items.length) {
    lines.push("");
    for (const item of report.items) lines.push(`${item.label}: ${item.value}`);
  }

  return sanitizeDisplayText(lines.join("\n"));
}

export function formatStatuslineManualHelp(input: {
  currentFields: readonly { id: string; label: string }[];
  availableFields: readonly { id: string; label: string }[];
  saved?: boolean;
  unknown?: readonly string[];
}): string {
  const lines: string[] = [];
  lines.push(input.saved ? "Statusline updated" : "Statusline");
  lines.push("");
  lines.push(`Current: ${input.currentFields.length ? input.currentFields.map((field) => field.id).join(" ") : "(empty)"}`);
  lines.push(`Available: ${input.availableFields.map((field) => field.id).join(" ")}`);
  lines.push("");
  lines.push("Manual form: /statusline repo branch context_window quota_5h session_total");
  lines.push("Clear: /statusline clear");
  if (input.unknown?.length) lines.push(`Unknown: ${input.unknown.map((item) => toNonEmptyString(item)).filter(Boolean).join(", ")}`);
  return lines.join("\n");
}

export { describeCredentialSource };

