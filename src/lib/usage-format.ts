import {
  formatLocalDateTime,
  formatPercent,
  formatQuantity,
  formatReset,
  sanitizeDisplayText
} from "./format.js";
import type { UsageReport, UsageWindow } from "./providers.js";

function formatWindow(window: UsageWindow): string {
  const parts: string[] = [];
  if (window.usedPercent !== undefined) parts.push(`${formatPercent(window.usedPercent)} used`);
  if (window.remainingPercent !== undefined) parts.push(`${formatPercent(window.remainingPercent)} left`);
  const unit = window.unit ? ` ${window.unit}` : "";
  const used = formatQuantity(window.used);
  const total = formatQuantity(window.total);
  if (used !== undefined && total !== undefined) parts.push(`${used}/${total}${unit}`);
  else if (used !== undefined) parts.push(`used ${used}${unit}`);
  else if (total !== undefined) parts.push(`limit ${total}${unit}`);
  const reset = formatReset(window);
  if (reset) parts.push(`reset ${reset}`);
  return `${window.label}: ${parts.join(", ") || "available"}`;
}

export function formatUsageReport(report: UsageReport | undefined): string {
  if (!report) {
    return [
      "Provider quota unavailable",
      "",
      "Could not resolve the current provider/model. Open a session, send one model request, or select a model."
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push("Provider quota");
  lines.push("");
  lines.push(`Provider: ${report.providerName ? `${report.providerName} (${report.providerID})` : report.providerID}`);
  if (report.modelID) lines.push(`Model: ${report.modelID}`);
  if (report.auth) lines.push(`Auth: ${report.auth}`);
  if (report.plan) lines.push(`Plan: ${report.plan}`);
  const updated = formatLocalDateTime(report.generatedAtMs);
  if (updated) lines.push(`Updated: ${updated}`);
  if (report.stale) lines.push("Cache: stale (last successful read)");
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
