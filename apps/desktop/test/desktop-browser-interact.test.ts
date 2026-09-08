import { afterEach, describe, expect, it, vi } from "vitest";
import type { PatcherDesktopBrowserInteraction } from "@patcher/desktop-contract";
import {
  PATCHER_BROWSER_ACTIONABILITY_SCRIPT,
  PATCHER_BROWSER_ACTION_TIMEOUT_MS,
} from "../src/desktop-browser-actions.js";
import { InteractionDeadline } from "../src/desktop-browser-actionability.js";
import type { CdpSession } from "../src/desktop-browser-cdp.js";
import {
  CdpStalledError,
  PATCHER_DESKTOP_BROWSER_INPUT_TIMEOUT_MS,
} from "../src/desktop-browser-cdp-deadline.js";
import { performInteraction } from "../src/desktop-browser-interact.js";

/**
 * What an action does when the page stops answering part-way through it.
 *
 * The manager's own suite drives every action end to end against a fake
 * debugger that always answers, which is the right shape for everything except
 * this: the case here is a send that never comes back, and a test for it has to
 * hold the timers. It is also the one refusal in the interaction path that
 * cannot say nothing happened, so what the message says matters as much as that
 * it arrives.
 */

const TARGET = { backendNodeId: 77, objectId: "object-1" };
const READY = {
  ready: true,
  x: 12,
  y: 34,
  rect: { x: 10, y: 30, width: 40, height: 20 },
} as const;
const COVERED = { ready: false, reason: "covered" } as const;

/**
 * The actionability wait's own best-effort scroll, which every ref-based action
 * makes before it does anything else. Spelled out rather than filtered away,
 * because "what reached the page" is the assertion these tests turn on and a
 * fake that quietly dropped one send would be answering a different question.
 */
const SCROLL = "DOM.scrollIntoViewIfNeeded";

interface FakeSession {
  session: CdpSession;
  /** Every method sent, in order, with the actionability polls left out. */
  sent: string[];
  /** Answer the send that is waiting, whatever it is. */
  answerPending: (value?: unknown) => void;
  pendingCount: () => number;
}

interface FakeSessionArgs {
  /** Answers for the actionability script, in order; the last one repeats. */
  samples: readonly Record<string, unknown>[];
  /** Methods that never answer on their own. */
  stall?: readonly string[];
}

function fakeSession(args: FakeSessionArgs): FakeSession {
  let polls = 0;
  const pending: Array<(value: unknown) => void> = [];
  const stall = new Set(args.stall ?? []);
  const fake: FakeSession = {
    sent: [],
    answerPending: (value) => {
      const resolve = pending.shift();
      expect(resolve, "nothing is waiting").toBeDefined();
      resolve?.(value ?? {});
    },
    pendingCount: () => pending.length,
    session: {
      send: <TResult>(
        method: string,
        params?: Record<string, unknown>,
      ): Promise<TResult> => {
        const isPoll =
          method === "Runtime.callFunctionOn" &&
          params?.functionDeclaration === PATCHER_BROWSER_ACTIONABILITY_SCRIPT;
        if (isPoll) {
          const sample = args.samples[Math.min(polls, args.samples.length - 1)];
          polls += 1;
          return Promise.resolve({ result: { value: sample } } as TResult);
        }
        fake.sent.push(method);
        if (!stall.has(method)) {
          return Promise.resolve({} as TResult);
        }
        return new Promise<TResult>((resolve) => {
          pending.push(resolve as (value: unknown) => void);
        });
      },
      enableDomain: async () => undefined,
      on: () => () => undefined,
      detach: () => undefined,
      isAttached: () => true,
    },
  };
  return fake;
}

function interact(args: {
  session: CdpSession;
  interaction: PatcherDesktopBrowserInteraction;
  dialogOpen?: () => boolean;
}): Promise<void> {
  return performInteraction({
    session: args.session,
    resolveTarget: async () => TARGET,
    request: { tabId: "tab-1", interaction: args.interaction },
    deadline: new InteractionDeadline(PATCHER_BROWSER_ACTION_TIMEOUT_MS),
    dialogOpen: args.dialogOpen ?? (() => false),
  });
}

const CLICK: PatcherDesktopBrowserInteraction = {
  action: "click",
  ref: "e1",
  button: "left",
  clickCount: 1,
  modifiers: [],
};

function settling<T>(work: Promise<T>): Promise<T | unknown> {
  return work.then(
    (value) => value,
    (error: unknown) => error,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("an action whose page stops answering", () => {
  it("gives up on a click the page never acknowledges", async () => {
    vi.useFakeTimers();
    const fake = fakeSession({
      samples: [READY, READY],
      stall: ["Input.dispatchMouseEvent"],
    });

    const acting = settling(
      interact({ session: fake.session, interaction: CLICK }),
    );
    // The move went out and is waiting. Before the deadline this is where the
    // command stayed for as long as the tab lived, holding that tab's queue.
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.sent).toEqual([SCROLL, "Input.dispatchMouseEvent"]);
    expect(fake.pendingCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(PATCHER_DESKTOP_BROWSER_INPUT_TIMEOUT_MS);
    const error = await acting;
    expect(error).toBeInstanceOf(CdpStalledError);
    expect((error as CdpStalledError).method).toBe("Input.dispatchMouseEvent");
  });

  it("does not tell the caller the click never landed", async () => {
    vi.useFakeTimers();
    const fake = fakeSession({
      samples: [READY, READY],
      stall: ["Input.dispatchMouseEvent"],
    });

    const acting = settling(
      interact({ session: fake.session, interaction: CLICK }),
    );
    await vi.advanceTimersByTimeAsync(
      PATCHER_DESKTOP_BROWSER_INPUT_TIMEOUT_MS + 100,
    );

    // Every other refusal on this path ends "nothing was sent to the page",
    // and a caller acts on that. This one cannot: the event is in the page.
    const message = ((await acting) as Error).message;
    expect(message).toContain("Look at the page");
    expect(message).not.toContain("nothing was sent");
  });

  it("names the dialog when the click itself opened one", async () => {
    vi.useFakeTimers();
    const fake = fakeSession({
      samples: [READY, READY],
      stall: ["Input.dispatchMouseEvent"],
    });
    let dialogOpen = false;

    const acting = settling(
      interact({
        session: fake.session,
        interaction: CLICK,
        dialogOpen: () => dialogOpen,
      }),
    );
    // The realistic order: the shell learns about the dialog from a `Page`
    // event while the send it opened is still pending.
    await vi.advanceTimersByTimeAsync(100);
    dialogOpen = true;
    await vi.advanceTimersByTimeAsync(PATCHER_DESKTOP_BROWSER_INPUT_TIMEOUT_MS);

    const message = ((await acting) as Error).message;
    expect(message).toContain("A JavaScript dialog is open on that tab");
    expect(message).toContain("answer or dismiss it");
  });

  it("finishes a slow `type` late rather than halfway", async () => {
    vi.useFakeTimers();
    const fake = fakeSession({
      samples: [READY, READY],
      stall: ["Input.dispatchKeyEvent"],
    });

    const acting = interact({
      session: fake.session,
      interaction: { action: "type", ref: "e1", text: "abc" },
    });
    // Six key events for three characters, each answered just inside its own
    // budget. Under one budget for the whole action the third character would
    // be refused and the field left holding "ab" — which is why the input
    // clock is per send.
    for (let event = 0; event < 6; event += 1) {
      await vi.advanceTimersByTimeAsync(
        PATCHER_DESKTOP_BROWSER_INPUT_TIMEOUT_MS - 1,
      );
      expect(fake.pendingCount()).toBe(1);
      fake.answerPending();
      await vi.advanceTimersByTimeAsync(0);
    }
    await acting;

    expect(fake.sent).toEqual([
      SCROLL,
      "DOM.focus",
      ...Array.from({ length: 6 }, () => "Input.dispatchKeyEvent"),
    ]);
  });

  it("stops a `type` the page is answering just slowly enough", async () => {
    // The other side of the per-send budget, and the reason it is not the whole
    // story: `type` is the one action whose length the caller chooses — two
    // events a character, up to 1 024 of them — so a page that answers each
    // just inside five seconds holds that tab's queue for hours, and the page
    // picks the timing. Nine characters at very nearly ten seconds each is past
    // the minute, so the action has to stop part-way rather than run on.
    const TEXT = "abcdefghi";
    vi.useFakeTimers();
    const startedAt = Date.now();
    const fake = fakeSession({
      samples: [READY, READY],
      stall: ["Input.dispatchKeyEvent"],
    });

    // The settle time, not the test's clock: the loop below advances once more
    // after the action has already ended, so `Date.now()` at the end of it
    // overstates how long the action took by a whole poll.
    let endedAt: number | undefined;
    const acting = interact({
      session: fake.session,
      interaction: { action: "type", ref: "e1", text: TEXT },
    }).then(
      (value): unknown => {
        endedAt = Date.now();
        return value;
      },
      (error: unknown): unknown => {
        endedAt = Date.now();
        return error;
      },
    );
    // Generous, and it ends on the break: the point is where *the action*
    // stops, so the loop keeps answering until there is nothing left waiting.
    for (let event = 0; event < TEXT.length * 2 + 2; event += 1) {
      await vi.advanceTimersByTimeAsync(
        PATCHER_DESKTOP_BROWSER_INPUT_TIMEOUT_MS - 1,
      );
      if (fake.pendingCount() === 0) {
        break;
      }
      fake.answerPending();
      await vi.advanceTimersByTimeAsync(0);
    }

    const error = await acting;
    expect(error).toBeInstanceOf(CdpStalledError);
    // Not "the tab stopped answering": every send was answered, and quickly
    // enough each time. What ran out is the action's own minute, and the
    // sentence has to say which of the two happened — plus how much of the
    // text is in the field, because that is what the caller has to look at.
    const message = (error as Error).message;
    expect(message).toContain(`of ${TEXT.length} keystrokes`);
    // What it must *not* promise: a send being acknowledged says the key event
    // was processed, not that the character survived in the field — a page can
    // cancel a key, cap the length, reformat or move focus. So the sentence
    // sends the caller to read the value rather than to type the rest.
    expect(message).toContain("read the field's value");
    expect(message).not.toContain("are in the field");
    // An even number of key events: the ceiling is checked between characters,
    // so the action stops on a whole keystroke rather than between a key's
    // down and its up — which the first spelling of this got wrong, leaving a
    // key logically held in the page.
    const keys = fake.sent.filter(
      (method) => method === "Input.dispatchKeyEvent",
    );
    expect(keys.length % 2).toBe(0);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.length).toBeLessThan(TEXT.length * 2);
    // And the arithmetic, which "it stopped part-way" does not check: the
    // ceiling is only honest if the action is *over* by then. Reserving room
    // for a whole keystroke is what buys that — checking for any time left
    // would let a two-send character start with milliseconds to spare and
    // finish ten seconds late.
    expect(endedAt).toBeDefined();
    expect((endedAt ?? 0) - startedAt).toBeLessThanOrEqual(60_000);
  });

  it("still refuses with the reason the actionability check measured", async () => {
    // The refusal that was already here, run through the new code: a covered
    // element ends the action with "something is on top of it" and nothing
    // reaches the page. What this does *not* claim is that the wait keeps the
    // unbounded session — measured by sabotage, putting it on the acting
    // session changes nothing while the two budgets are both 5 000ms, because
    // the action's clock starts first and expires first. The reason to keep
    // them apart is in `performInteraction`, along with what would make the
    // difference observable.
    vi.useFakeTimers();
    const fake = fakeSession({ samples: [COVERED] });

    const acting = settling(
      interact({ session: fake.session, interaction: CLICK }),
    );
    await vi.advanceTimersByTimeAsync(PATCHER_BROWSER_ACTION_TIMEOUT_MS * 2);

    const error = await acting;
    expect(error).not.toBeInstanceOf(CdpStalledError);
    expect((error as Error).message).toContain("on top of");
    expect((error as Error).message).toContain("Nothing was sent to the page");
    // The wait's own scroll, and nothing else: no input reached the page.
    expect(fake.sent).toEqual([SCROLL]);
  });
});
