import { isRecord, toFiniteNumber } from "../format.js";
import { baseReport, errorReport, fetchJson, resetAtFromDate, USER_AGENT, windowFromUsage } from "./shared.js";
import type { AdapterInput, ProviderAdapter, UsageReport } from "./types.js";

async function collectOpenCodeGo(input: AdapterInput): Promise<UsageReport> {
  const credential = input.apiCredential;
  if (!credential) {
    return errorReport({
      ...input,
      error: "No usable credential found in the V2 credential store or environment"
    });
  }

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
    return errorReport({
      ...input,
      auth: credential.source,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export const opencodeGoAdapter: ProviderAdapter = {
  id: "opencode-go",
  aliases: ["opencode-go", "opencodego"],
  integrationIDs: ["opencode-go", "opencodego"],
  env: ["OPENCODE_API_KEY"],
  credential: "api-key",
  collect: collectOpenCodeGo
};
