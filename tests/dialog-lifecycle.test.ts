import { describe, expect, it, vi } from "vitest";
import { DialogRequestLifecycle } from "../src/lib/dialog-lifecycle.js";

describe("DialogRequestLifecycle", () => {
  it("ignores replaced and stale request callbacks", () => {
    const lifecycle = new DialogRequestLifecycle();
    let firstClose: (() => void) | undefined;
    let secondClose: (() => void) | undefined;
    const first = lifecycle.begin();
    lifecycle.install(first, (onClose) => {
      firstClose = onClose;
    });

    const second = lifecycle.begin();
    lifecycle.install(second, (onClose) => {
      firstClose?.();
      secondClose = onClose;
    });

    expect(lifecycle.isCurrent(first)).toBe(false);
    expect(lifecycle.isCurrent(second)).toBe(true);
    firstClose?.();
    expect(lifecycle.isCurrent(second)).toBe(true);
    secondClose?.();
    expect(lifecycle.isOpen()).toBe(false);
  });

  it("invalidates pending results when the dialog is cancelled", () => {
    const lifecycle = new DialogRequestLifecycle();
    const request = lifecycle.begin();
    const replace = vi.fn();

    expect(lifecycle.cancel()).toBe(true);
    expect(lifecycle.isCurrent(request)).toBe(false);
    expect(lifecycle.install(request, replace)).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});
