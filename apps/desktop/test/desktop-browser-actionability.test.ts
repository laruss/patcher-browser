import { describe, expect, it, vi } from "vitest";
import {
  PATCHER_BROWSER_ACTIONABILITY_SCRIPT,
  PATCHER_BROWSER_ACTION_POLL_INTERVAL_MS,
  PATCHER_BROWSER_ACTION_TIMEOUT_MS,
} from "../src/desktop-browser-actions.js";
import {
  InteractionDeadline,
  waitForActionable,
} from "../src/desktop-browser-actionability.js";
import type { CdpSession } from "../src/desktop-browser-cdp.js";

/**
 * Which refusal the actionability wait ends with when its budget runs out.
 *
 * The manager's own suite covers the ordinary refusals end to end — that a
 * `covered` element ends the action, and that nothing reaches the page when it
 * does. What it cannot drive is *where* in the 50ms poll cycle the 5s budget
 * runs out, and that decided which of two messages the caller got: the reason
 * the check measured, or "ran out of time". The deadline is read before the
 * sleep, so a sleep that overshot by a millisecond left the next round trip to
 * expire against the deadline instead — one idle run in twelve, measured, and
 * a CI failure on a loaded runner (#74).
 *
 * Both halves are here, because the fix is a precedence and a precedence has
 * two sides: with a sample in hand the measured reason wins, and with none the
 * clock is genuinely all there is to say.
 */

interface FakeSessionArgs {
  /** Answers for `Runtime.callFunctionOn`, in order; the last one repeats. */
  answers: readonly (Record<string, unknown> | "stall")[];
}

function fakeSession(args: FakeSessionArgs): {
  session: CdpSession;
  calls: () => number;
} {
  let calls = 0;
  const session: CdpSession = {
    async send<TResult>(
      method: string,
      params?: Record<string, unknown>,
    ): Promise<TResult> {
      if (method !== "Runtime.callFunctionOn") {
        return undefined as TResult;
      }
      expect(params?.functionDeclaration).toBe(
        PATCHER_BROWSER_ACTIONABILITY_SCRIPT,
      );
      const answer = args.answers[Math.min(calls, args.answers.length - 1)];
      calls += 1;
      if (answer === "stall") {
        // A renderer that stopped answering: the abandoned call never settles,
        // which is what the deadline exists to bound.
        return new Promise<TResult>(() => undefined);
      }
      return { result: { value: answer } } as TResult;
    },
    on: () => () => undefined,
    enableDomain: async () => undefined,
    detach: () => undefined,
    isAttached: () => true,
  };
  return { session, calls: () => calls };
}

const COVERED = { ready: false, reason: "covered" } as const;
const TARGET = { backendNodeId: 77, objectId: "object-1" };

async function runOutTheBudget(work: Promise<unknown>): Promise<unknown> {
  // Settled before the clock moves: the refusal arrives while the timers are
  // being advanced, and a handler attached afterwards is one Node has already
  // reported as an unhandled rejection.
  const settled = work.then(
    (value) => value,
    (error: unknown) => error,
  );
  // A poll longer than the budget, so the loop reaches whichever end it takes.
  await vi.advanceTimersByTimeAsync(
    PATCHER_BROWSER_ACTION_TIMEOUT_MS + PATCHER_BROWSER_ACTION_POLL_INTERVAL_MS,
  );
  return settled;
}

describe("the actionability wait, when its budget runs out", () => {
  it("answers with the reason it measured when the check stalls after a sample", async () => {
    // One good look at the element, then a renderer that stops answering. The
    // deadline expires inside that round trip — the case that used to throw the
    // measured reason away.
    const { session } = fakeSession({ answers: [COVERED, "stall"] });
    vi.useFakeTimers();
    try {
      const outcome = await runOutTheBudget(
        waitForActionable(
          session,
          TARGET,
          new InteractionDeadline(PATCHER_BROWSER_ACTION_TIMEOUT_MS),
        ),
      );
      expect(outcome).toMatchObject({ reason: "not-actionable" });
      // The whole value of the check: "something is on top of it" tells an
      // agent to dismiss the overlay, where "ran out of time" tells it nothing.
      expect((outcome as Error).message).toContain("on top of");
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers with the clock when it never got a sample", async () => {
    // Nothing was measured, so there is nothing better to report — and the
    // caller has to be able to tell "did not happen" from "has not happened
    // yet". This is the half a broader precedence would have broken.
    const { session } = fakeSession({ answers: ["stall"] });
    vi.useFakeTimers();
    try {
      const outcome = await runOutTheBudget(
        waitForActionable(
          session,
          TARGET,
          new InteractionDeadline(PATCHER_BROWSER_ACTION_TIMEOUT_MS),
        ),
      );
      expect(outcome).toMatchObject({ reason: "not-actionable" });
      expect((outcome as Error).message).toContain("Ran out of time");
      expect((outcome as Error).message).toContain("nothing was sent");
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls until the budget is spent, and says so once", async () => {
    // The ordinary path, at the same speed: an element that stays covered is
    // sampled for the whole budget and refused with its reason.
    const { session, calls } = fakeSession({ answers: [COVERED] });
    vi.useFakeTimers();
    try {
      const outcome = await runOutTheBudget(
        waitForActionable(
          session,
          TARGET,
          new InteractionDeadline(PATCHER_BROWSER_ACTION_TIMEOUT_MS),
        ),
      );
      expect((outcome as Error).message).toContain("on top of");
      // 5 000ms of budget at a 50ms poll: it really did keep looking rather
      // than refusing on the first sample.
      expect(calls()).toBeGreaterThan(50);
    } finally {
      vi.useRealTimers();
    }
  });
});
