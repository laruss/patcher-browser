/**
 * A CDP session with a clock on it.
 *
 * A protocol send has no deadline of its own, and most of what the shell sends
 * is answered by the *renderer* — the accessibility tree, an expression, an
 * input event. A renderer that has stopped answering therefore leaves the
 * command open with nothing to end it: found in review before it shipped, a
 * page that opens a `confirm()` from a click keeps that click pending for as
 * long as the dialog stands, and since the app serialises commands per tab
 * (`tab-queue.ts`) everything behind it on that tab waits too. That is why
 * answering a dialog and closing a tab are the only two commands that never
 * queue: they are the way out, and they had to be reachable while a tab was
 * wedged.
 *
 * **Why a decorator and not a `race` at each send.** The sends that hang are
 * spread across helpers three call sites deep — `ensureDialogInterception`,
 * `resolveSelectorNode`, `enableDomain` — each shared by several commands, so
 * threading a clock through them would put the parameter in five signatures to
 * bound four sends. Wrapping the session bounds every send the command makes,
 * including the ones added later, and costs one line where the command starts.
 *
 * **Nothing is cancelled, because a CDP command cannot be.** The abandoned
 * send is left to settle on its own and its answer is dropped — the same
 * discipline `InteractionDeadline.race` and `withPageReadDeadline` already
 * follow, and for the same reason: a late answer must not resolve a call the
 * caller has already been told about.
 *
 * What that leaves behind on the input path is worth naming, because "look at
 * the page" is the only mitigation there is. A click is three sends; if the
 * dialog opens on `mousePressed`, the `mouseReleased` after it is never sent,
 * so the page is left with a button held down and reads the next pointer move
 * as a drag. A `type` can stop between a key's down and up the same way. That
 * is not new — the command used to hang there instead, with the same half-sent
 * sequence in the page and nobody able to act on the tab at all — but it is now
 * reachable by a caller who is told what happened, which is the trade this
 * makes. Raised by the security review on 2026-09-07.
 *
 * **And a stateful send that is abandoned can leave the shell's bookkeeping
 * disagreeing with Chromium.** A route table, a network override, a screencast:
 * the send may land after the refusal, so neither "it happened" nor "it did
 * not" is knowable. Where the wrong answer is *reported* to a caller it is
 * reverted — `route-set` puts its table back, because `route-list` would
 * otherwise describe a mock that is not intercepting — and where a late arrival
 * would strand Chromium in a state nothing could reach, it is undone by a
 * following send, which is ordered behind it: a stalled `Page.startScreencast`
 * gets a `Page.stopScreencast` queued after it. What is deliberately *not* done
 * is detaching the session to reset both sides at once. It looks like the
 * general answer and is the wrong one here: the likeliest reason a send stalled
 * is a dialog holding the renderer, and detaching hands that dialog back to
 * Chromium's native modal, which nothing can answer for the life of the tab.
 *
 * **What the two budget shapes are for.** {@link cdpBudget} gives a whole
 * command one clock, which is right for a read: it is one answer the caller
 * waits on once, and abandoning it leaves nothing behind. A constant
 * `remainingMs` gives every send its own, which is right for the sends that
 * carry out an action, because a budget for the whole action would stop a
 * `type` into a slow page with half the text in the field — the one thing
 * `InteractionDeadline`'s own docstring says not to do.
 *
 * **Where the clocks are, and why each is the shape it is.** Collected here
 * rather than in six paragraphs across `desktop-browser-view.ts`, which is the
 * longest file in the repository and pinned at its size: the rule counts
 * comment lines on purpose, because what it limits is how much of one file a
 * reader has to hold at once, and this reasoning is about one subject rather
 * than about six call sites.
 *
 * - **A snapshot** gets one budget for the command ({@link cdpBudget}). Every
 *   send in it is a renderer round trip, and a tab that has stopped answering —
 *   blocked on a dialog an earlier command left open, or busy-looping — would
 *   otherwise leave the command pending until the tab went, holding that tab's
 *   queue with it. One budget rather than one per send because a snapshot is
 *   one answer the caller waits on once, and abandoning it leaves nothing
 *   behind.
 * - **A full-page capture** gets the same, and needs it most: it deliberately
 *   does *not* take the tab's dialogs over — a picture should not change how the
 *   browser behaves for the person using it — so it is the one command that can
 *   be blocked by a dialog it cannot see or answer.
 * - **An evaluation** gets its own, far longer budget, because
 *   `Runtime.callFunctionOn` is sent with `awaitPromise`: the thing being waited
 *   for is the caller's own code, so an expression awaiting a `fetch` is
 *   legitimately slow. What it ends is the expression that never settles.
 * - **An interaction** splits in two. Everything before the first event that
 *   touches the page — enabling `DOM`, creating the isolated world, resolving
 *   the ref, scrolling the element into view — is raced against the
 *   `InteractionDeadline` that was already there, whose refusal can truthfully
 *   say nothing was sent. Everything after it goes through a per-send budget
 *   here, whose refusal cannot.
 * - **Vision mode's** mouse sends are the interaction path's dispatch with the
 *   ref lookup taken out, and hang for the same reason, so they get the same
 *   per-send budget.
 * - **`Page.enable`** is bounded inside `ensureDialogInterception` rather than
 *   at each of the five commands that call it: it is the one send that function
 *   makes, enabling a domain is renderer work like anything else, and before
 *   that `control` and `record` could still wait forever on a tab already
 *   blocked.
 * - **Filming** gets the per-send budget too — starting and stopping a
 *   screencast are renderer sends, so a film could hold a tab's queue the way
 *   the rest did.
 *
 * **What every one of those refusals must not do is claim more than it knows.**
 * A stall coming out of a broad `catch` as somebody else's fault is the failure
 * mode this had twice before review found it: a stalled `DOM.querySelector`
 * read as an invalid selector, telling a caller to fix syntax that was fine,
 * and a stalled `DOM.resolveNode` read as a stale ref, telling them to take a
 * fresh snapshot — the one thing that cannot work on a page that has stopped
 * answering. Every `catch` around a bounded send rethrows {@link CdpStalledError}
 * before translating anything else, and every command's own `catch` maps it to
 * `page-stalled` rather than to `failed`, because `failed` is where a message
 * goes to die: the app turns it into "the page could not be inspected".
 */
import type { CdpSession } from "./desktop-browser-cdp.js";

/**
 * How long a snapshot may spend in the page.
 *
 * The whole command, not one send. Generous because the tree arrives whole and
 * a large document is legitimately slow to walk, and still inside the caller's
 * own wait at its widest (60s) so a slow snapshot answers rather than being
 * refused twice.
 */
export const PATCHER_DESKTOP_BROWSER_SNAPSHOT_TIMEOUT_MS = 15_000;

/**
 * How long an evaluation may spend in the page.
 *
 * The most generous of the three, because the thing being waited for is the
 * caller's own code: `Runtime.callFunctionOn` is sent with `awaitPromise`, so
 * an expression that awaits a `fetch` is legitimately slow and refusing it at
 * five seconds would break the reason `eval` exists. What this bounds is the
 * expression that never settles at all — `new Promise(() => {})`, a lock
 * nothing releases — which is otherwise a tab whose queue never drains.
 */
export const PATCHER_DESKTOP_BROWSER_EVAL_TIMEOUT_MS = 30_000;

/**
 * How long one input send may take.
 *
 * Per send rather than per action, so an action still finishes late instead of
 * halfway. Five seconds is not a latency budget — a mouse event is acknowledged
 * in milliseconds — it is the point past which the renderer is not going to
 * answer at all.
 */
export const PATCHER_DESKTOP_BROWSER_INPUT_TIMEOUT_MS = 5_000;

/**
 * What to do about it, appended to both sentences below.
 *
 * The dialog half is the actionable one and the reason this error carries a
 * message at all: a page blocked on `confirm()` is not a fault, it is a tab
 * waiting for an answer that the caller can give (`browser dialog`) — and
 * nothing else in the refusal would say so, because from the caller's side a
 * stalled click and a broken page look identical.
 */
function whatToDo(dialogOpen: boolean): string {
  return dialogOpen
    ? "A JavaScript dialog is open on that tab and blocks the page until it is answered — answer or dismiss it, then look at the page."
    : "The page may be busy or wedged. Look at the page rather than assuming this command did nothing.";
}

/**
 * The tab stopped answering the debugger.
 *
 * Its own error rather than the deadline refusals beside it, because it is the
 * one that **cannot** say nothing happened: the send went out, and whether the
 * page acted on it before it stopped answering is not knowable from here. Every
 * call site turns it into that surface's refusal with this message intact —
 * which is the whole value of it, so the message is written for whoever reads
 * it rather than for a log.
 */
export class CdpStalledError extends Error {
  /** The CDP method that never came back, for a person reading a log. */
  readonly method: string;
  /**
   * How long that send was given, or zero when it never went out.
   *
   * A field rather than part of the sentence. The sentence is read by an agent
   * deciding what to do next, and nothing it can do depends on the number —
   * while putting it there made the number wrong in the one case that matters,
   * a shared budget with 400ms left reading as "after 0s".
   */
  readonly waitedMs: number;

  constructor(message: string, method: string, waitedMs: number) {
    super(message);
    this.name = "CdpStalledError";
    this.method = method;
    this.waitedMs = waitedMs;
  }
}

/** A send that went out and was never answered. */
function stalledSend(
  method: string,
  waitedMs: number,
  dialogOpen: boolean,
): CdpStalledError {
  return new CdpStalledError(
    `The browser tab stopped answering \`${method}\`, so Patcher stopped ` +
      `waiting for it. ${whatToDo(dialogOpen)}`,
    method,
    waitedMs,
  );
}

/**
 * A command that ran out of its shared budget between sends.
 *
 * A different sentence because it is a different fact: this send never left, so
 * whatever the command has already done to the page is all it did. Only
 * reachable under {@link cdpBudget} — a per-send budget is a constant and never
 * runs out.
 */
function budgetSpent(method: string, dialogOpen: boolean): CdpStalledError {
  return new CdpStalledError(
    `This browser command ran out of time in the page before it sent ` +
      `\`${method}\`. ${whatToDo(dialogOpen)}`,
    method,
    0,
  );
}

export interface CdpDeadlineOptions {
  /**
   * How long the *next* send may take. Called once per send, so a constant
   * gives every send its own budget and a countdown gives them all one.
   */
  remainingMs: () => number;
  /**
   * Whether a JavaScript dialog is holding this tab, for the refusal to name.
   *
   * A function rather than a flag: the dialog usually opens *because* of the
   * send being waited on, so the answer only becomes true while the clock is
   * running. Left out by callers with no way to know — a session whose `Page`
   * domain was never enabled sees no dialog events at all — and then the
   * sentence simply does not claim either way.
   */
  dialogOpen?: () => boolean;
}

/**
 * One clock for a whole command: a `remainingMs` that counts down from now.
 *
 * Read at each send rather than captured, so the budget covers the command
 * rather than each of its parts.
 */
export function cdpBudget(totalMs: number): () => number {
  const at = Date.now() + totalMs;
  return () => at - Date.now();
}

/**
 * The same session, with every send bounded.
 *
 * `on`, `detach` and `isAttached` pass straight through: they are local calls
 * that cannot hang, and a subscription that expired with a send would drop the
 * dialog event this module's own message depends on.
 */
export function cdpSessionWithDeadline(
  session: CdpSession,
  options: CdpDeadlineOptions,
): CdpSession {
  const dialogOpen = (): boolean => options.dialogOpen?.() === true;
  /**
   * `start` is a thunk rather than a promise so the spent-budget branch can
   * refuse *without* sending. Taking the promise as an argument would issue the
   * send while evaluating the call, and `budgetSpent` would be claiming
   * something that had already left.
   */
  const bound = async <T>(
    method: string,
    start: () => Promise<T>,
  ): Promise<T> => {
    const budget = options.remainingMs();
    if (budget <= 0) {
      throw budgetSpent(method, dialogOpen());
    }
    const work = start();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(stalledSend(method, budget, dialogOpen())),
        budget,
      );
    });
    try {
      return await Promise.race([work, expiry]);
    } finally {
      clearTimeout(timer);
      void work.catch(() => undefined);
    }
  };

  return {
    send: <TResult>(method: string, params?: Record<string, unknown>) =>
      bound<TResult>(method, () => session.send<TResult>(method, params)),
    enableDomain: (domain: string) =>
      bound(`${domain}.enable`, () => session.enableDomain(domain)),
    on: (method, listener) => session.on(method, listener),
    detach: () => session.detach(),
    isAttached: () => session.isAttached(),
  };
}
