import { errorReport } from "./shared.js";
import type { ProviderAdapter } from "./types.js";

export const opencodeZenAdapter: ProviderAdapter = {
  id: "opencode-zen",
  aliases: ["opencode"],
  integrationIDs: ["opencode"],
  env: [],
  credential: "none",
  collect: async (input) =>
    errorReport({
      ...input,
      error: "OpenCode Console usage is available from the built-in /usage command"
    })
};
