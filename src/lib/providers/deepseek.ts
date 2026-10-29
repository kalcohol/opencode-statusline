import { isRecord, formatMoney, toNonEmptyString } from "../format.js";
import { baseReport, errorReport, fetchJson, USER_AGENT } from "./shared.js";
import type { AdapterInput, ProviderAdapter, UsageReport } from "./types.js";

async function collectDeepSeek(input: AdapterInput): Promise<UsageReport> {
  const credential = input.apiCredential;
  if (!credential) {
    return errorReport({
      ...input,
      error: "No usable credential found in the V2 credential store or environment"
    });
  }

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
    return errorReport({
      ...input,
      auth: credential.source,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export const deepseekAdapter: ProviderAdapter = {
  id: "deepseek",
  aliases: ["deepseek"],
  integrationIDs: ["deepseek"],
  env: ["DEEPSEEK_API_KEY"],
  credential: "api-key",
  collect: collectDeepSeek
};
