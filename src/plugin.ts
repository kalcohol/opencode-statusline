import type { Plugin } from "@opencode-ai/plugin";
import {
  buildCurrentProviderUsageReport,
  injectIgnoredText,
  type MinimalOpencodeClient
} from "./lib/opencode-client.js";
import { STATUSLINE_FIELDS, loadStatuslineConfig, parseStatuslineFieldArguments, saveStatuslineConfig } from "./lib/statusline-config.js";
import { formatStatuslineManualHelp, formatUsageReport } from "./lib/usage-format.js";

const COMMAND_HANDLED = "__OPENCODE_STATUSLINE_COMMAND_HANDLED__";

type CommandInput = {
  command: string;
  sessionID: string;
  arguments?: string;
  model?: unknown;
};

type ConfigInput = {
  command?: Record<string, { template: string; description: string }>;
};

function handled(): never {
  throw new Error(COMMAND_HANDLED);
}

function statuslineFieldRows(ids: readonly string[]) {
  return ids.flatMap((id) => {
    const field = STATUSLINE_FIELDS.find((item) => item.id === id);
    return field ? [{ id: field.id, label: field.label }] : [];
  });
}

async function handleUsage(client: MinimalOpencodeClient, input: CommandInput): Promise<never> {
  const result = await buildCurrentProviderUsageReport({
    client,
    sessionID: input.sessionID,
    force: true,
    commandModel: input.model
  });
  await injectIgnoredText(client, input.sessionID, formatUsageReport(result.report));
  handled();
}

async function handleStatusline(client: MinimalOpencodeClient, input: CommandInput): Promise<never> {
  const args = input.arguments ?? "";
  let saved = false;
  let unknown: readonly string[] = [];
  if (args.trim()) {
    const parsed = parseStatuslineFieldArguments(args);
    unknown = parsed.unknown;
    if (parsed.clear || parsed.fields.length > 0) {
      saveStatuslineConfig({ version: 1, fields: parsed.clear ? [] : parsed.fields });
      saved = true;
    }
  }

  const current = loadStatuslineConfig().fields;
  const output = formatStatuslineManualHelp({
    currentFields: statuslineFieldRows(current),
    availableFields: STATUSLINE_FIELDS,
    saved,
    unknown
  });
  await injectIgnoredText(client, input.sessionID, output);
  handled();
}

export const StatuslinePlugin: Plugin = async ({ client }) => {
  const typedClient = client as unknown as MinimalOpencodeClient;
  return {
    config: async (input: unknown) => {
      const config = input as ConfigInput;
      config.command ??= {};
      config.command.usage = {
        template: "/usage",
        description: "Show current provider usage without adding it to model context."
      };
      config.command.statusline = {
        template: "/statusline",
        description: "Configure statusline fields. Example: /statusline repo branch quota_5h"
      };
    },
    "command.execute.before": async (input: CommandInput) => {
      if (input.command === "usage") return handleUsage(typedClient, input);
      if (input.command === "statusline") return handleStatusline(typedClient, input);
    }
  };
};

export function isStatuslineCommandHandled(err: unknown): boolean {
  return err instanceof Error && err.message === COMMAND_HANDLED;
}

