import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getAuthJsonPath,
  getOpencodeDataDir,
  getOpencodeStateDir,
  resolveApiCredential,
  resolveOAuthCredential
} from "../src/lib/auth.js";

const savedEnv = { ...process.env };
let tempDir = "";

describe("OpenCode paths and credentials", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-statusline-auth-"));
    delete process.env.OPENCODE_STATUSLINE_DATA_DIR;
    delete process.env.OPENCODE_STATUSLINE_STATE_DIR;
    delete process.env.OPENCODE_AUTH_JSON;
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses the same XDG data and state roots as current OpenCode on every platform", () => {
    process.env.XDG_DATA_HOME = path.join(tempDir, "data");
    process.env.XDG_STATE_HOME = path.join(tempDir, "state");

    expect(getOpencodeDataDir()).toBe(path.join(tempDir, "data", "opencode"));
    expect(getOpencodeStateDir()).toBe(path.join(tempDir, "state", "opencode"));
    expect(getAuthJsonPath()).toBe(path.join(tempDir, "data", "opencode", "auth.json"));
  });

  it("skips an API entry when resolving a later OAuth alias", () => {
    const authPath = path.join(tempDir, "auth.json");
    process.env.OPENCODE_AUTH_JSON = authPath;
    fs.writeFileSync(authPath, JSON.stringify({
      openai: { type: "api", key: "api-key" },
      codex: { type: "oauth", access: "oauth-access", accountId: "account-1" }
    }));

    expect(resolveOAuthCredential(["openai", "codex", "chatgpt"])).toMatchObject({
      access: "oauth-access",
      accountId: "account-1",
      source: { type: "auth", label: "auth.json:codex" }
    });
  });

  it("skips an OAuth entry when resolving a later API alias", () => {
    const authPath = path.join(tempDir, "auth.json");
    process.env.OPENCODE_AUTH_JSON = authPath;
    fs.writeFileSync(authPath, JSON.stringify({
      first: { type: "oauth", access: "oauth-access" },
      second: { type: "api", key: "api-key" }
    }));

    expect(resolveApiCredential({
      env: [],
      providerIDs: [],
      authKeys: ["first", "second"]
    })).toMatchObject({
      token: "api-key",
      source: { type: "auth", label: "auth.json:second" }
    });
  });
});
