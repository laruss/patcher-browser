import { describe, expect, it } from "vitest";
import { patcherDesktopBrowserRecordOperationSchema } from "@patcher/desktop-contract";
import { browserRecordOperationSchema } from "@patcher/domain";

/**
 * The fifth union written twice — and the first that is deliberately *not* the
 * same on both wires.
 *
 * The video half must match, for the reason the other four unions must (see
 * interaction-contract.test.ts): the executor forwards a value parsed by the
 * agent schema straight into the shell's. The trace half must not: it never
 * leaves the app, and a shell that accepted it would be claiming to keep a log
 * it cannot keep. Both halves of that claim are pinned here, because a later
 * "tidy-up" that made the two unions identical would break the second one
 * silently.
 */

const VIDEO: unknown[] = [
  { kind: "video-start", fps: 1 },
  { kind: "video-start", fps: 30 },
  { kind: "video-chapter", title: "signed in" },
  { kind: "video-stop" },
];

const TRACE_ONLY: unknown[] = [
  { kind: "trace-start", screenshots: false },
  { kind: "trace-start", screenshots: true },
  { kind: "trace-stop" },
];

const REJECTED: unknown[] = [
  {},
  { kind: "video-start" },
  { kind: "video-start", fps: 0 },
  { kind: "video-start", fps: 31 },
  { kind: "video-start", fps: 2.5 },
  { kind: "video-chapter" },
  { kind: "video-chapter", title: "" },
  { kind: "video-pause" },
];

describe("the recording union, on both wires", () => {
  it("accepts the same video operations", () => {
    for (const value of VIDEO) {
      expect(
        browserRecordOperationSchema.safeParse(value).success,
        `domain: ${JSON.stringify(value)}`,
      ).toBe(true);
      expect(
        patcherDesktopBrowserRecordOperationSchema.safeParse(value).success,
        `desktop: ${JSON.stringify(value)}`,
      ).toBe(true);
    }
  });

  it("keeps the trace on the agent wire only", () => {
    for (const value of TRACE_ONLY) {
      expect(
        browserRecordOperationSchema.safeParse(value).success,
        `domain: ${JSON.stringify(value)}`,
      ).toBe(true);
      expect(
        patcherDesktopBrowserRecordOperationSchema.safeParse(value).success,
        `desktop: ${JSON.stringify(value)}`,
      ).toBe(false);
    }
  });

  it("rejects the same operations", () => {
    for (const value of REJECTED) {
      expect(
        browserRecordOperationSchema.safeParse(value).success,
        `domain: ${JSON.stringify(value)}`,
      ).toBe(false);
      expect(
        patcherDesktopBrowserRecordOperationSchema.safeParse(value).success,
        `desktop: ${JSON.stringify(value)}`,
      ).toBe(false);
    }
  });
});
