import type { ModelInfo, SessionInfo, SessionMessageAssistant, SessionMessageInfo, TokenUsageInfo } from "@opencode/client";
import { describe, expect, it } from "vitest";
import type { UsageReport } from "../src/lib/providers.js";
import {
  buildStatuslineSnapshot,
  familyGenerationMetrics,
  generationMetrics,
  generationMetricsAfter,
  hasVcsProvider,
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

  it("uses wall-clock union for family generation speed", () => {
    const user = (id: string, created: number) =>
      ({ id, type: "user", time: { created } }) as unknown as SessionMessageInfo;
    const parentMessages = [
      user("parent-user", 0),
      assistant({ id: "parent-assistant", created: 0, streamed: 10_000, completed: 10_100, tokens: tokens(100, 100, 0) })
    ];
    const childMessages = [
      user("child-user", 5_000),
      assistant({ id: "child-assistant", created: 5_000, streamed: 15_000, completed: 15_100, tokens: tokens(100, 100, 0) })
    ];

    expect(
      familyGenerationMetrics({
        parentMessages,
        children: [{ messages: childMessages }],
        now: 20_000
      })?.tokensPerSecond
    ).toBeCloseTo(200 / 15, 2);

    expect(
      familyGenerationMetrics({
        parentMessages,
        children: [
          {
            messages: [
              user("serial-user", 10_000),
              assistant({ id: "serial-assistant", created: 10_000, streamed: 20_000, completed: 20_100, tokens: tokens(100, 100, 0) })
            ]
          }
        ],
        now: 25_000
      })?.tokensPerSecond
    ).toBe(10);
  });

  it("uses the last completed turn when idle markers trail the parent history", () => {
    const user = (id: string, created: number) =>
      ({ id, type: "user", time: { created } }) as unknown as SessionMessageInfo;
    const idle = (id: string, created: number) =>
      ({ id, type: "idle", time: { created } }) as unknown as SessionMessageInfo;
    const parentMessages = [
      user("old-user", 0),
      assistant({ id: "old-assistant", created: 0, streamed: 5_000, completed: 5_100, tokens: tokens(100, 100, 0) }),
      idle("old-idle", 5_500),
      user("current-user", 10_000),
      assistant({ id: "current-assistant", created: 10_000, streamed: 20_000, completed: 20_100, tokens: tokens(100, 100, 0) }),
      idle("current-idle", 20_500)
    ];

    expect(
      familyGenerationMetrics({
        parentMessages,
        children: [],
        now: 25_000
      })?.tokensPerSecond
    ).toBe(10);
  });

  it("does not include child work that starts after a completed parent turn", () => {
    const user = (id: string, created: number) =>
      ({ id, type: "user", time: { created } }) as unknown as SessionMessageInfo;
    const parentMessages = [
      user("parent-user", 0),
      assistant({ id: "parent-assistant", created: 0, streamed: 10_000, completed: 10_100, tokens: tokens(100, 100, 0) })
    ];
    const laterChildMessages = [
      user("later-child-user", 12_000),
      assistant({ id: "later-child-assistant", created: 12_000, streamed: 17_000, completed: 17_100, tokens: tokens(100, 100, 0) })
    ];

    expect(
      familyGenerationMetrics({
        parentMessages,
        children: [{ messages: laterChildMessages }],
        now: 25_000
      })?.tokensPerSecond
    ).toBe(10);
  });

  it("does not mix the previous parent turn while a new turn has no assistant yet", () => {
    const user = (id: string, created: number) =>
      ({ id, type: "user", time: { created } }) as unknown as SessionMessageInfo;
    const idle = (id: string, created: number) =>
      ({ id, type: "idle", time: { created } }) as unknown as SessionMessageInfo;
    const parentMessages = [
      user("old-user", 0),
      assistant({ id: "old-assistant", created: 0, streamed: 10_000, completed: 10_100, tokens: tokens(100, 100, 0) }),
      idle("old-idle", 10_500),
      user("new-user", 12_000)
    ];
    const childMessages = [
      user("child-user", 13_000),
      assistant({ id: "child-assistant", created: 13_000, streamed: 18_000, completed: 18_100, tokens: tokens(100, 100, 0) })
    ];

    expect(
      familyGenerationMetrics({
        parentMessages,
        parentRunning: true,
        children: [{ messages: childMessages }],
        now: 20_000
      })
    ).toBeUndefined();
  });

  it("excludes child turns from before the parent turn", () => {
    const user = (id: string, created: number) =>
      ({ id, type: "user", time: { created } }) as unknown as SessionMessageInfo;
    const parentMessages = [
      user("parent-user", 10_000),
      assistant({ id: "parent-assistant", created: 10_000, streamed: 20_000, completed: 20_100, tokens: tokens(100, 100, 0) })
    ];
    const oldChildMessages = [
      user("old-child-user", 0),
      assistant({ id: "old-child-assistant", created: 0, streamed: 5_000, completed: 5_100, tokens: tokens(100, 100, 0) })
    ];

    expect(
      familyGenerationMetrics({
        parentMessages,
        children: [{ messages: oldChildMessages }],
        now: 25_000
      })?.tokensPerSecond
    ).toBe(10);
  });

  it("keeps the zero diff value for a clean repository", () => {
    const snapshot = buildStatuslineSnapshot({
      messages: [],
      models: [],
      sessions: [session({ id: "root" })],
      gitDiff: { added: 0, removed: 0 }
    });

    expect(renderStatuslineParts(snapshot, ["git_diff_stats"])).toEqual([
      { field: "git_diff_stats", text: "+0,-0" }
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

  it("computes generation speed only after an explicit execution boundary", () => {
    const user = (id: string, created: number) =>
      ({ id, type: "user", time: { created } }) as unknown as SessionMessageInfo;
    const messages = [
      user("old-user", 100),
      assistant({ id: "old-assistant", created: 200, streamed: 1200, completed: 1300, tokens: tokens(100, 100, 0) }),
      user("boundary", 2000),
      user("new-user", 2100),
      assistant({ id: "new-assistant", created: 2200, streamed: 4200, completed: 4300, tokens: tokens(100, 800, 0) })
    ];

    expect(generationMetricsAfter(messages, "boundary")?.tokensPerSecond).toBe(400);
    expect(generationMetricsAfter(messages, "missing")).toBeUndefined();
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

  it("ignores idle markers after a revert boundary when choosing the turn start", () => {
    const user = (id: string, created: number) =>
      ({ id, type: "user", time: { created } }) as unknown as SessionMessageInfo;
    const idle = (id: string, created: number) =>
      ({ id, type: "idle", time: { created } }) as unknown as SessionMessageInfo;
    const boundary = { id: "boundary", type: "user", time: { created: 5000 } } as unknown as SessionMessageInfo;
    const first = assistant({
      id: "msg-1",
      created: 200,
      streamed: 1200,
      completed: 1300,
      tokens: tokens(100, 100, 0)
    });
    const second = assistant({
      id: "msg-2",
      created: 2100,
      streamed: 4100,
      completed: 4200,
      tokens: tokens(100, 800, 0)
    });

    expect(generationMetrics([user("user-1", 100), first, user("user-2", 2000), second, boundary])?.tokensPerSecond).toBe(400);
    expect(
      generationMetrics([user("user-1", 100), first, user("user-2", 2000), second, boundary, idle("idle-future", 6000)])
        ?.tokensPerSecond
    ).toBe(400);
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

  it("renders family generation speed", () => {
    const snapshot = buildStatuslineSnapshot({
      messages: [],
      models: [],
      sessions: [session({ id: "root" })],
      familyGeneration: { tokensPerSecond: 42 }
    });

    expect(renderStatuslineParts(snapshot, ["family_generation"])).toEqual([
      { field: "family_generation", text: "family gen 42 tok/s" }
    ]);
  });

  it("shows a transient subagent completion badge with speed", () => {
    const snapshot = buildStatuslineSnapshot({
      messages: [],
      models: [],
      sessions: [session({ id: "root" })],
      subagentDoneCount: 1,
      subagentDoneSpeed: 42
    });

    expect(renderStatuslineParts(snapshot, ["subagent_status"])).toEqual([
      { field: "subagent_status", text: "sub 1 done · 42 tok/s" }
    ]);
  });

  it("combines running and completed subagents", () => {
    const snapshot = buildStatuslineSnapshot({
      messages: [],
      models: [],
      sessions: [session({ id: "root" })],
      subagentCount: 2,
      subagentDoneCount: 1
    });

    expect(renderStatuslineParts(snapshot, ["subagent_status"])).toEqual([
      { field: "subagent_status", text: "sub 2 running · 1 done" }
    ]);
  });

  it("detects a VCS repository by provider presence", () => {
    expect(hasVcsProvider({ provider: "git" })).toBe(true);
    expect(hasVcsProvider({})).toBe(false);
    expect(hasVcsProvider(undefined)).toBe(false);
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
