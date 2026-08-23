import { describe, expect, it } from "vitest";
import { computeMutedPrefixLength } from "./compute-muted-prefix-length";

describe("computeMutedPrefixLength", () => {
  it("returns 0 for user-initiated text", () => {
    expect(computeMutedPrefixLength("user", "[Patcher system]\n\nhello")).toBe(
      0,
    );
  });

  it("returns 0 when text does not start with [patcher", () => {
    expect(computeMutedPrefixLength("system", "hello world")).toBe(0);
    expect(computeMutedPrefixLength("agent", "[other] body")).toBe(0);
  });

  it("returns 0 when there is no closing ]", () => {
    expect(computeMutedPrefixLength("system", "[Patcher system unclosed")).toBe(
      0,
    );
  });

  it("eats \\n\\n after ] for block-form messages", () => {
    const text = "[Patcher system]\n\nWelcome!";
    // Expect the body to begin at "Welcome!" — `[Patcher system]\n\n`.length === 18.
    expect(computeMutedPrefixLength("system", text)).toBe(18);
    expect(text.slice(18)).toBe("Welcome!");
  });

  it("eats a single space after ] for inline-form messages", () => {
    const text = "[Patcher system] Thread completed.";
    // `[Patcher system] `.length === 17.
    expect(computeMutedPrefixLength("system", text)).toBe(17);
    expect(text.slice(17)).toBe("Thread completed.");
  });

  it("returns text.length when the entire text is the prefix", () => {
    const text = "[Patcher system]";
    expect(computeMutedPrefixLength("system", text)).toBe(text.length);
  });

  it("handles the agent prefix shape", () => {
    const prefix = "[Patcher message from thread:thr_sender]";
    const text = `${prefix}\n\nHi`;
    // The whole prefix + the `\n\n` separator gets absorbed.
    expect(computeMutedPrefixLength("agent", text)).toBe(prefix.length + 2);
    expect(text.slice(prefix.length + 2)).toBe("Hi");
  });
});
