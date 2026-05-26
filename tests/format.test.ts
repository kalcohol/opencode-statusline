import { describe, expect, it } from "vitest";
import { formatTokenAmount } from "../src/lib/format.js";

describe("formatTokenAmount", () => {
  it("keeps values below 1024 in base units", () => {
    expect(formatTokenAmount(1023)).toBe("1023");
  });

  it("promotes by 1024", () => {
    expect(formatTokenAmount(1536)).toBe("1.5K");
    expect(formatTokenAmount(1024 * 1024)).toBe("1M");
  });
});
