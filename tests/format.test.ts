import { describe, expect, it } from "vitest";
import { formatLocalDateTime, formatReset, formatTokenAmount } from "../src/lib/format.js";

describe("formatTokenAmount", () => {
  it("keeps values below 1024 in base units", () => {
    expect(formatTokenAmount(1023)).toBe("1023");
  });

  it("promotes by 1024", () => {
    expect(formatTokenAmount(1536)).toBe("1.5K");
    expect(formatTokenAmount(1024 * 1024)).toBe("1M");
  });
});

describe("formatLocalDateTime", () => {
  it("uses fixed-width local date and time fields", () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);

    expect(formatLocalDateTime(date.getTime())).toBe("2026-01-02 03:04:05");
  });
});

describe("formatReset", () => {
  it("uses the same fixed-width format for absolute reset timestamps", () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);

    expect(formatReset({ resetAtMs: date.getTime() })).toBe("2026-01-02 03:04:05");
  });
});
