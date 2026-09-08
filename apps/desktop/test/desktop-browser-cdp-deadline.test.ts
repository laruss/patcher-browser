import { afterEach, describe, expect, it, vi } from "vitest";
import {
  patcherDesktopBrowserCaptureFullPageResultSchema,
  patcherDesktopBrowserInteractResultSchema,
} from "@patcher/desktop-contract";
import type { CdpSession } from "../src/desktop-browser-cdp.js";
import {
  cdpBudget,
  cdpSessionWithDeadline,
  CdpStalledError,
} from "../src/desktop-browser-cdp-deadline.js";

/**
 * The clock on a CDP session.
 *
 * What this covers that the manager's suite cannot: a renderer that stops
 * answering *mid-command*. The manager drives whole commands against a fake
 * debugger, and a fake that never answers used to mean a test that never ends —
 * which is exactly why the shell went so long with no deadline on these sends.
 * So the decorator is tested here, on its own, with the timers under control.
 */

interface FakeSession {
  session: CdpSession;
  /** Every method the raw session was asked for, in order. */
  sent: string[];
  /** Answer a send that is still waiting. */
  answer: (method: string, value?: unknown) => void;
  /** Fail a send that is still waiting, the way a detached target does. */
  reject: (method: string, error: Error) => void;
  domainsEnabled: string[];
  detached: number;
  subscribed: string[];
}

/**
 * A session that answers nothing until told to.
 *
 * Deliberately not "stalls on request": every send here hangs by default and a
 * test resolves the ones it wants answered, because the case being measured is
 * a send with no answer and a default that answers would make the stalling
 * tests the exceptional ones.
 */
function fakeSession(): FakeSession {
  const waiting = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const fake: FakeSession = {
    sent: [],
    domainsEnabled: [],
    detached: 0,
    subscribed: [],
    answer: (method, value) => {
      const pending = waiting.get(method);
      expect(pending, `nothing is waiting on ${method}`).toBeDefined();
      waiting.delete(method);
      pending?.resolve(value ?? {});
    },
    reject: (method, error) => {
      const pending = waiting.get(method);
      expect(pending, `nothing is waiting on ${method}`).toBeDefined();
      waiting.delete(method);
      pending?.reject(error);
    },
    session: {
      send: <TResult>(method: string): Promise<TResult> => {
        fake.sent.push(method);
        return new Promise<TResult>((resolve, reject) => {
          waiting.set(method, {
            resolve: resolve as (value: unknown) => void,
            reject,
          });
        });
      },
      enableDomain: (domain: string): Promise<void> => {
        fake.domainsEnabled.push(domain);
        fake.sent.push(`${domain}.enable`);
        return new Promise<void>((resolve, reject) => {
          waiting.set(`${domain}.enable`, {
            resolve: () => resolve(),
            reject,
          });
        });
      },
      on: (method) => {
        fake.subscribed.push(method);
        return () => undefined;
      },
      detach: () => {
        fake.detached += 1;
      },
      isAttached: () => true,
    },
  };
  return fake;
}

/**
 * Take hold of the rejection before the clock moves.
 *
 * The same discipline `desktop-browser-actionability.test.ts` follows: a
 * refusal that arrives while the timers are being advanced, with the handler
 * attached afterwards, is one Node has already reported as an unhandled
 * rejection — which vitest prints beside the pass count rather than failing on.
 */
function settling<T>(work: Promise<T>): Promise<T | unknown> {
  return work.then(
    (value) => value,
    (error: unknown) => error,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("a CDP session with a clock on it", () => {
  it("hands an answer back untouched when one arrives in time", async () => {
    const fake = fakeSession();
    const bounded = cdpSessionWithDeadline(fake.session, {
      remainingMs: () => 5_000,
    });

    const read = bounded.send<{ nodes: number }>("Accessibility.getFullAXTree");
    fake.answer("Accessibility.getFullAXTree", { nodes: 3 });

    expect(await read).toEqual({ nodes: 3 });
    expect(fake.sent).toEqual(["Accessibility.getFullAXTree"]);
  });

  it("gives up on a send the tab never answers, naming the method", async () => {
    vi.useFakeTimers();
    const fake = fakeSession();
    const bounded = cdpSessionWithDeadline(fake.session, {
      remainingMs: () => 5_000,
    });

    const stalled = settling(bounded.send("Input.dispatchMouseEvent"));
    await vi.advanceTimersByTimeAsync(4_999);
    // Still waiting: the budget is a deadline, not a hint.
    expect(fake.sent).toEqual(["Input.dispatchMouseEvent"]);
    await vi.advanceTimersByTimeAsync(1);

    const error = await stalled;
    expect(error).toBeInstanceOf(CdpStalledError);
    expect((error as CdpStalledError).method).toBe("Input.dispatchMouseEvent");
    expect((error as CdpStalledError).waitedMs).toBe(5_000);
    expect((error as Error).message).toContain("`Input.dispatchMouseEvent`");
  });

  it("never says nothing happened, because it cannot know", async () => {
    vi.useFakeTimers();
    const fake = fakeSession();
    const bounded = cdpSessionWithDeadline(fake.session, {
      remainingMs: () => 1_000,
    });

    const stalled = settling(bounded.send("Input.dispatchMouseEvent"));
    await vi.advanceTimersByTimeAsync(1_000);

    const message = ((await stalled) as Error).message;
    // The whole reason this error is not one of the deadline refusals beside
    // it: the send went out, so the caller has to look rather than assume.
    expect(message).toContain("Look at the page");
    expect(message).not.toContain("nothing was sent");
  });

  it("names the dialog when one is holding the tab", async () => {
    vi.useFakeTimers();
    const fake = fakeSession();
    let dialogOpen = false;
    const bounded = cdpSessionWithDeadline(fake.session, {
      remainingMs: () => 1_000,
      dialogOpen: () => dialogOpen,
    });

    const stalled = settling(bounded.send("Input.dispatchMouseEvent"));
    // Opened by the click itself, which is the realistic order: the flag is
    // false when the send goes out and true by the time the clock runs out.
    dialogOpen = true;
    await vi.advanceTimersByTimeAsync(1_000);

    const message = ((await stalled) as Error).message;
    expect(message).toContain("A JavaScript dialog is open on that tab");
    expect(message).toContain("answer or dismiss it");
  });

  it("says only that the page may be busy when it can see no dialog", async () => {
    vi.useFakeTimers();
    const fake = fakeSession();
    const bounded = cdpSessionWithDeadline(fake.session, {
      remainingMs: () => 1_000,
      dialogOpen: () => false,
    });

    const stalled = settling(bounded.send("Accessibility.getFullAXTree"));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(((await stalled) as Error).message).toContain(
      "The page may be busy or wedged",
    );
  });

  it("drops the answer to a send it has already given up on", async () => {
    vi.useFakeTimers();
    const fake = fakeSession();
    const bounded = cdpSessionWithDeadline(fake.session, {
      remainingMs: () => 1_000,
    });

    const stalled = settling(bounded.send("Runtime.callFunctionOn"));
    await vi.advanceTimersByTimeAsync(1_000);
    await stalled;

    // The abandoned send settles late, both ways round. Neither may reach
    // anyone: a CDP command cannot be recalled, and its answer is no longer
    // anybody's to read. An unhandled rejection here would take the main
    // process down.
    fake.reject(
      "Runtime.callFunctionOn",
      new Error("the debugger was detached"),
    );
    const second = settling(bounded.send("Runtime.evaluate"));
    await vi.advanceTimersByTimeAsync(1_000);
    await second;
    fake.answer("Runtime.evaluate", { late: true });
    await vi.advanceTimersByTimeAsync(1);
  });

  describe("one budget for a command, or one per send", () => {
    it("spends a shared budget across the sends of one command", async () => {
      vi.useFakeTimers();
      const fake = fakeSession();
      const bounded = cdpSessionWithDeadline(fake.session, {
        remainingMs: cdpBudget(1_000),
      });

      const first = bounded.send("DOM.getDocument");
      await vi.advanceTimersByTimeAsync(600);
      fake.answer("DOM.getDocument", { root: 1 });
      expect(await first).toEqual({ root: 1 });

      // 400ms of the command's second left, not another 1000.
      const second = settling(bounded.send("DOM.querySelector"));
      await vi.advanceTimersByTimeAsync(399);
      expect(await Promise.race([second, "still waiting"])).toBe(
        "still waiting",
      );
      await vi.advanceTimersByTimeAsync(1);
      expect(await second).toBeInstanceOf(CdpStalledError);
    });

    it("refuses without sending once a shared budget is gone", async () => {
      vi.useFakeTimers();
      const fake = fakeSession();
      const bounded = cdpSessionWithDeadline(fake.session, {
        remainingMs: cdpBudget(1_000),
      });

      await vi.advanceTimersByTimeAsync(1_000);
      const error = await settling(bounded.send("Accessibility.getFullAXTree"));

      // The one case where the refusal *can* promise something, and the reason
      // the check happens before the send rather than as a zero-length race.
      expect(fake.sent).toEqual([]);
      expect((error as Error).message).toContain(
        "ran out of time in the page before it sent",
      );
      expect((error as CdpStalledError).waitedMs).toBe(0);
    });

    it("gives every send its own budget when the budget is a constant", async () => {
      vi.useFakeTimers();
      const fake = fakeSession();
      const bounded = cdpSessionWithDeadline(fake.session, {
        remainingMs: () => 1_000,
      });

      // Three keystrokes of a `type`, each nearly out of time and each
      // answered. A budget for the whole action would have refused the third
      // and left the field holding two thirds of the text — the failure this
      // shape exists to avoid.
      for (const nth of [1, 2, 3]) {
        const key = bounded.send<{ nth: number }>("Input.dispatchKeyEvent");
        await vi.advanceTimersByTimeAsync(900);
        fake.answer("Input.dispatchKeyEvent", { nth });
        expect(await key).toEqual({ nth });
      }
      expect(fake.sent).toHaveLength(3);
    });
  });

  it("bounds enabling a domain, which is a send like any other", async () => {
    vi.useFakeTimers();
    const fake = fakeSession();
    const bounded = cdpSessionWithDeadline(fake.session, {
      remainingMs: () => 1_000,
    });

    const enabling = settling(bounded.enableDomain("Accessibility"));
    await vi.advanceTimersByTimeAsync(1_000);

    const error = await enabling;
    expect(error).toBeInstanceOf(CdpStalledError);
    expect((error as CdpStalledError).method).toBe("Accessibility.enable");
    expect(fake.domainsEnabled).toEqual(["Accessibility"]);
  });

  it("makes a refusal the wire will actually carry", async () => {
    // Two things at once, and both are the contract rather than a copy of it.
    // The result schema caps `message` at 1 024 characters and its parse is
    // strict about that, so a sentence that outgrew the cap would turn a
    // refusal into a parse failure at the boundary — and the reason has to come
    // back as itself rather than through `.catch("failed")`, which is what an
    // older shell's value degrades to. Measured with the dialog branch, which
    // is the longer of the two sentences.
    vi.useFakeTimers();
    const fake = fakeSession();
    const bounded = cdpSessionWithDeadline(fake.session, {
      remainingMs: () => 1_000,
      dialogOpen: () => true,
    });

    const stalled = settling(
      bounded.send("Emulation.clearDeviceMetricsOverride"),
    );
    await vi.advanceTimersByTimeAsync(1_000);

    const message = ((await stalled) as Error).message;
    // Both enums that carry this refusal, because `.catch("failed")` means a
    // reason the schema has not heard of comes back as `failed` rather than
    // throwing — so parsing is the only way to tell "shipped" from "silently
    // degraded", and doing it for one enum says nothing about the others. The
    // capture enum is here because a review pointed out that this test passed
    // with the full-page half of the fix removed.
    for (const schema of [
      patcherDesktopBrowserInteractResultSchema,
      patcherDesktopBrowserCaptureFullPageResultSchema,
    ]) {
      expect(
        schema.parse({ ok: false, reason: "page-stalled", message }),
      ).toMatchObject({ ok: false, reason: "page-stalled" });
    }
  });

  it("leaves subscribing, detaching and the attached flag alone", () => {
    const fake = fakeSession();
    const bounded = cdpSessionWithDeadline(fake.session, {
      remainingMs: () => 0,
    });

    // Even with no budget at all: these are local calls that cannot hang, and
    // an expired subscription would drop the dialog event the message above
    // depends on.
    bounded.on("Page.javascriptDialogOpening", () => undefined);
    bounded.detach();

    expect(fake.subscribed).toEqual(["Page.javascriptDialogOpening"]);
    expect(fake.detached).toBe(1);
    expect(bounded.isAttached()).toBe(true);
  });
});
