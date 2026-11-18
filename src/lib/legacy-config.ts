import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isRecord } from "./format.js";
import {
  normalizeStatuslineField,
  uniqueFields,
  type StatuslineFieldID
} from "./statusline-config.js";

// V1 stored field selection next to the OpenCode data directory.
function legacyConfigPaths(): string[] {
  const explicit = process.env.OPENCODE_STATUSLINE_CONFIG;
  if (explicit) return [explicit];

  if (process.env.OPENCODE_STATUSLINE_DATA_DIR) {
    return [path.join(process.env.OPENCODE_STATUSLINE_DATA_DIR, "statusline-plugin.json")];
  }
  if (process.env.XDG_DATA_HOME) {
    return [path.join(process.env.XDG_DATA_HOME, "opencode", "statusline-plugin.json")];
  }
  return [path.join(os.homedir(), ".local", "share", "opencode", "statusline-plugin.json")];
}

/**
 * One-time bridge for upgrades from the V1 plugin, which kept its selection in
 * a standalone JSON file. The first V2 launch without stored settings uses this
 * as the initial value; once the V2 store exists it always wins.
 */
export function loadLegacyStatuslineFields(): StatuslineFieldID[] | undefined {
  for (const file of legacyConfigPaths()) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!isRecord(parsed) || !Array.isArray(parsed.fields)) continue;
      const fields = parsed.fields
        .map((field) => (typeof field === "string" ? normalizeStatuslineField(field) : undefined))
        .filter((field): field is StatuslineFieldID => Boolean(field));
      return uniqueFields(fields);
    } catch {
      // Missing or malformed legacy state is not an error.
    }
  }
  return undefined;
}
