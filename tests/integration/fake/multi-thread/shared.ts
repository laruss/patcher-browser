import type { ThreadEventRow } from "@patcher/domain";
import { expect } from "vitest";
import { scaleTimeoutMs } from "../../helpers/time.js";

// Setup and reprovision waits: environment creation, cleanup, and shared-workspace reloads.
/**
 * How long a thread gets to become ready.
 *
 * Ten seconds was too tight, and not by a little: becoming ready here means a
 * real server provisions a workspace — a managed worktree is several `git`
 * processes — and under a full `turbo run test` that reliably lost the same
 * test while the suite's own `testTimeout` sat at sixty seconds. A helper that
 * gives up first turns a busy machine into a failed assertion about the
 * product.
 */
export const DEFAULT_TIMEOUT_MS = scaleTimeoutMs(30_000);
// Whole-turn waits: sibling threads should finish a standard turn inside this window.
export const TURN_TIMEOUT_MS = scaleTimeoutMs(15_000);
// Active-turn waits: enough time to observe concurrent threads become active.
export const ACTIVE_TIMEOUT_MS = scaleTimeoutMs(5_000);
// Reprovision waits: managed cleanup plus a fresh start can take longer than a normal turn.
export const REPROVISION_TIMEOUT_MS = scaleTimeoutMs(25_000);
// Fake provider inputs accept `delay:<ms>` prefixes to keep sibling turns overlapping.
export const CONCURRENT_DELAY_TEXT = "delay:800";

export function countTurnEvents(
  events: ThreadEventRow[],
  type: "turn/completed" | "turn/started",
): number {
  return events.filter((event) => event.type === type).length;
}

export function assertEventsBelongToThread(
  events: ThreadEventRow[],
  threadId: string,
): void {
  expect(events.length).toBeGreaterThan(0);
  expect(events.every((event) => event.threadId === threadId)).toBe(true);
}
