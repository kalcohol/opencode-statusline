import type { Plugin } from "@opencode-ai/plugin";
import {
  buildCurrentProviderUsageReport,
  injectIgnoredText,
  type MinimalOpencodeClient
} from "./lib/opencode-client.js";
import { formatUsageReport } from "./lib/usage-format.js";

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
    },
    "command.execute.before": async (input: CommandInput) => {
      if (input.command === "usage") return handleUsage(typedClient, input);
    }
  };
};

export function isStatuslineCommandHandled(err: unknown): boolean {
  return err instanceof Error && err.message === COMMAND_HANDLED;
}
