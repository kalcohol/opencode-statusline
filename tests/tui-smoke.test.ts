import { describe, expect, it, vi } from "vitest";

vi.mock("@opentui/core", () => ({
  TextAttributes: { BOLD: 1 }
}));

vi.mock("@opentui/solid", () => ({
  createComponent: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  createElement: vi.fn(),
  createTextNode: vi.fn(),
  effect: vi.fn(),
  insert: vi.fn(),
  insertNode: vi.fn(),
  memo: <Value>(read: () => Value) => read,
  setProp: vi.fn(),
  use: vi.fn(),
  useTerminalDimensions: () => () => ({ width: 160, height: 40 })
}));

vi.mock("@opentui/solid/jsx-dev-runtime", () => ({
  Fragment: Symbol.for("opentui.fragment"),
  jsxDEV: (type: unknown, props: Record<string, unknown>) => ({ type, props })
}));

vi.mock("@opentui/solid/jsx-runtime", () => ({
  Fragment: Symbol.for("opentui.fragment"),
  jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
  jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props })
}));

vi.mock("solid-js", () => ({
  For: vi.fn(),
  Show: vi.fn(),
  createEffect: vi.fn(),
  createMemo: <Value>(read: () => Value) => read,
  createSignal: <Value>(value: Value) => [() => value, vi.fn()],
  onCleanup: vi.fn()
}));

import pluginModule from "../dist/tui.js";

type RenderNode = {
  type?: unknown;
  props?: { children?: unknown } & Record<string, unknown>;
};

describe("TUI prompt integration", () => {
  it("keeps the host right slot inside the shared inline prompt path", async () => {
    let registeredSlots: Record<string, (ctx: unknown, props: any) => RenderNode> = {};
    const Prompt = vi.fn();
    const Slot = vi.fn();
    const api = {
      slots: {
        register(input: { slots: typeof registeredSlots }) {
          registeredSlots = input.slots;
        }
      },
      keymap: { registerLayer: vi.fn() },
      ui: { Prompt, Slot }
    };

    await pluginModule.tui(api as any, undefined, {} as any);
    const wrapper = registeredSlots.session_prompt?.({}, { session_id: "ses_1" });
    expect(wrapper).toBeTruthy();

    const promptNode = (wrapper?.type as (props: Record<string, unknown>) => RenderNode)(wrapper?.props ?? {});
    expect(promptNode.type).toBe(Prompt);
    const rightNode = promptNode.props?.right as RenderNode;
    expect((rightNode.type as { name?: string }).name).toBe("PromptRightContent");
  });
});
