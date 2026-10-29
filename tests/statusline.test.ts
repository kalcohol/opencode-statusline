import type { ModelInfo, SessionInfo, SessionMessageAssistant, SessionMessageInfo, TokenUsageInfo } from "@opencode/client";
import { describe, expect, it } from "vitest";
import type { UsageReport } from "../src/lib/providers.js";
import {
  buildStatuslineSnapshot,
  generationMetrics,
  providerBalanceText,
  renderStatuslineParts,
  sessionSubtree
} from "../src/lib/statusline.js";
import type { StatuslineFieldID } from "../src/lib/statusline-config.js";

const tokens = (input: number, output: number, reasoning = 0): TokenUsageInfo => ({
  input,
  output,
  reasoning,
  cache: { read: 0, write: 0 }
});

function session(input: {
  id: string;
  parentID?: string;
  cost?: number;
  tokens?: TokenUsageInfo;
}): SessionInfo {
  return {
    id: input.id,
    parentID: input.parentID,
    projectID: "project",
    model: { id: "model-a", providerID: "openrouter" },
    cost: input.cost ?? 0,
    tokens: input.tokens ?? tokens(0, 0),
    time: { created: 1, updated: 2 },
    location: { directory: "/repo/project" }
  };
}

function assistant(input: {
  id?: string;
  created?: number;
  streamed?: number;
  completed?: number;
  tokens?: TokenUsageInfo;
  toolMs?: number;
}): SessionMessageAssistant {
  return {
    id: input.id ?? "msg-1",
    type: "assistant",
    time: {
      created: input.created ?? 1000,
      streamed: input.streamed ?? 1500,
      completed: input.completed ?? 3500
    },
    agent: "build",
    model: { id: "model-a", providerID: "openrouter" },
    content:
      input.toolMs === undefined
        ? [{ type: "text", text: "hello" }]
        : [
            {
              type: "tool",
              id: "tool-1",
              name: "bash",
              state: { status: "completed", input: {}, content: [] },
              time: { created: 1600, ran: 1600, completed: 1600 + input.toolMs }
            }
          ],
    tokens: input.tokens ?? tokens(1000, 200, 50)
  };
}

const model: ModelInfo = {
  id: "model-a",
  modelID: "model-a",
  providerID: "openrouter",
  name: "Model A",
  capabilities: {},
  variants: [],
  time: { released: 1 },
  cost: [],
  status: "active",
  enabled: true,
  limit: { context: 100_000, output: 4096 }
};

const quota: UsageReport = {
  ok: true,
  providerID: "openrouter",
  generatedAtMs: 1,
  windows: [
    { key: "fiveHour", label: "5h quota", usedPercent: 32 },
    { key: "weekly", label: "Weekly quota", usedPercent: 61 }
  ],
  balances: [{ label: "remaining", value: "$12.34" }],
  items: []
};

describe("statusline snapshot rendering", () => {
  it("renders selected fields in order and omits unavailable values", () => {
    const root = session({ id: "root", cost: 0.02, tokens: tokens(1200, 300, 50) });
    const child = session({ id: "child", parentID: "root", cost: 0.03, tokens: tokens(400, 100) });
    const fields: StatuslineFieldID[] = [
      "repo",
      "branch",
      "git_diff_stats",
      "context_used",
      "context_window",
      "generation_metrics",
      "subagent_status",
      "quota_5h",
      "quota_weekly",
      "provider_balance",
      "session_io",
      "session_total",
      "session_cost"
    ];

    const snapshot = buildStatuslineSnapshot({
      messages: [assistant({ tokens: tokens(1000, 200, 50) })],
      models: [model],
      sessions: [root, child],
      session: root,
      repo: "project",
      branch: "main",
      gitDiff: { added: 12, removed: 3 },
      subagentCount: 1,
      quotaReport: quota
    });

    expect(renderStatuslineParts(snapshot, fields).map((part) => part.text)).toEqual([
      "project",
      "main",
      "+12,-3",
      "ctx 1.22K",
      "ctx 1.22K/97.7K",
      "gen 500 tok/s",
      "sub 1 running",
      "5h 32%",
      "week 61%",
      "bal $12.34",
      "1.56K in / 400 out",
      "2K used",
      "cost $0.05"
    ]);
  });

  it("keeps child subtree totals separate from siblings", () => {
    const root = session({ id: "root" });
    const first = session({ id: "first", parentID: "root", tokens: tokens(10, 1) });
    const second = session({ id: "second", parentID: "root", tokens: tokens(20, 2) });
    const grandchild = session({ id: "grandchild", parentID: "first", tokens: tokens(30, 3) });
    const family = [root, first, second, grandchild];
    const get = (id: string) => family.find((item) => item.id === id);

    expect(sessionSubtree("first", family.map((item) => item.id), get).map((item) => item.id)).toEqual([
      "first",
      "grandchild"
    ]);
    expect(sessionSubtree("root", family.map((item) => item.id), get).map((item) => item.id)).toEqual([
      "root",
      "first",
      "grandchild",
      "second"
    ]);
  });

  it("weights generation speed by provider-active duration across the turn", () => {
    const user = {
      id: "user-1",
      type: "user",
      time: { created: 900 }
    } as unknown as SessionMessageInfo;
    const first = assistant({
      id: "msg-1",
      created: 1000,
      streamed: 1500,
      completed: 1600,
      tokens: tokens(1000, 100, 0)
    });
    const second = assistant({
      id: "msg-2",
      created: 1600,
      streamed: 2000,
      completed: 2100,
      tokens: tokens(1000, 100, 50)
    });

    expect(generationMetrics([user, first, second])?.tokensPerSecond).toBeCloseTo(277.78, 1);
  });

  it("only aggregates the current turn when idle markers trail the history", () => {
    const idle = (id: string, created: number) =>
      ({ id, type: "idle", time: { created } }) as unknown as SessionMessageInfo;
    const user = (id: string, created: number) =>
      ({ id, type: "user", time: { created } }) as unknown as SessionMessageInfo;
    const messages = [
      user("user-1", 100),
      assistant({ id: "msg-1", created: 200, streamed: 1200, completed: 1300, tokens: tokens(100, 100, 0) }),
      idle("idle-1", 1400),
      user("user-2", 2000),
      assistant({ id: "msg-2", created: 2100, streamed: 4100, completed: 4200, tokens: tokens(100, 800, 0) }),
      idle("idle-2", 4300)
    ];

    expect(generationMetrics(messages)?.tokensPerSecond).toBe(400);
  });

  it("hides generation when the latest assistant has no tokens", () => {
    const user = { id: "user-1", type: "user", time: { created: 100 } } as unknown as SessionMessageInfo;
    const idle = { id: "idle-1", type: "idle", time: { created: 200 } } as unknown as SessionMessageInfo;
    const withoutTokens = {
      ...assistant({ id: "msg-2", created: 300, streamed: 500, completed: 600 }),
      tokens: undefined
    } as unknown as SessionMessageInfo;

    expect(generationMetrics([user, withoutTokens, idle])).toBeUndefined();
  });

  it("uses the last assistant model for the context limit", () => {
    const snapshot = buildStatuslineSnapshot({
      messages: [assistant({ tokens: tokens(1000, 100, 0) })],
      models: [model, { ...model, id: "model-b", modelID: "model-b", limit: { context: 200_000, output: 4096 } }],
      sessions: [session({ id: "root" })]
    });

    expect(snapshot.contextLimit).toBe(100_000);
  });

  it("does not borrow the current model's limit when the assistant model is absent", () => {
    const snapshot = buildStatuslineSnapshot({
      messages: [assistant({ tokens: tokens(1000, 100, 0) })],
      models: [{ ...model, id: "model-b", modelID: "model-b", limit: { context: 200_000, output: 4096 } }],
      sessions: [session({ id: "root" })]
    });

    expect(snapshot.contextUsed).toBe(1100);
    expect(snapshot.contextLimit).toBeUndefined();
  });

  it("prefers remaining balance rows", () => {
    expect(
      providerBalanceText({
        ...quota,
        balances: [
          { label: "credits", value: "$1.00" },
          { label: "limit remaining", value: "$12.34" }
        ]
      })
    ).toBe("bal $12.34");
  });
});
