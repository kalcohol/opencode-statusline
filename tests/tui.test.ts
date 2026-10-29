import { describe, expect, it, vi } from "vitest";
import plugin from "../dist/tui.js";
import { DEFAULT_STATUSLINE_FIELDS } from "../src/lib/statusline-config.js";

type StoredSettings = {
  version: number;
  fields?: string[];
};

function mockContext(initial: StoredSettings) {
  let state = initial;
  const claims: Array<Record<string, unknown>> = [];
  const layers: Array<{ commands?: Array<Record<string, any>> }> = [];
  const toast = vi.fn();
  const update = vi.fn(async (mutation: (draft: StoredSettings) => void) => {
    const draft = { ...state };
    mutation(draft);
    state = draft;
  });
  const context = {
    storage: {
      store: vi.fn(() => [state, update])
    },
    ui: {
      slot: vi.fn((claim: Record<string, unknown>) => {
        claims.push(claim);
        return () => {};
      }),
      toast: { show: toast },
      dialog: {
        select: vi.fn(async () => undefined),
        show: vi.fn(),
        set: vi.fn(),
        clear: vi.fn()
      },
      router: { current: () => ({ type: "home" }) }
    },
    keymap: {
      layer: vi.fn((factory: () => { commands: Array<Record<string, any>> }) => {
        layers.push(factory());
      })
    },
    data: {},
    client: {},
    location: undefined,
    theme: {},
    options: {}
  };
  return { context, claims, layers, state: () => state, toast };
}

describe("V2 TUI setup", () => {
  it("registers the prompt footer slot and both slash commands", async () => {
    const { context, claims, layers } = mockContext({
      version: 2,
      fields: ["branch", "quota_5h"]
    });

    await plugin.setup(context as never);

    expect(claims[0]).toMatchObject({ append: "prompt.footer.status" });
    const commands = layers[0]?.commands ?? [];
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "opencode-statusline.configure",
          slash: { name: "statusline", arguments: true }
        }),
        expect.objectContaining({
          id: "opencode-statusline.quota",
          slash: { name: "quota", arguments: true }
        })
      ])
    );
  });

  it("repairs persisted settings without fields", async () => {
    const { context, state, toast } = mockContext({ version: 2 });

    await plugin.setup(context as never);
    await Promise.resolve();

    expect(state().fields).toEqual([...DEFAULT_STATUSLINE_FIELDS]);
    expect(toast).not.toHaveBeenCalled();
  });

  it("repairs invalid persisted fields", async () => {
    const { context, state } = mockContext({
      version: 1,
      fields: ["branch", "branch", "nope"]
    });

    await plugin.setup(context as never);
    await Promise.resolve();

    expect(state()).toMatchObject({
      version: 2,
      fields: ["branch"]
    });
  });
});
