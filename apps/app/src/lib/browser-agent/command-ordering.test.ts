import { describe, expect, it } from "vitest";
import type { BrowserCommandIssuer } from "@patcher/server-contract";
import { createHarness, liveState, tab } from "@/test/browser-command-harness";
import { executeBrowserCommand } from "./execute";
import { createBrowserTabQueue } from "./tab-queue";
import { withBrowserTabOwner, type BrowserTabOwners } from "./tab-owners";

/**
 * Two commands, one browser.
 *
 * The executor's own suite sends one command at a time, which is exactly the
 * shape that hid this: every case in it passes whether or not commands can
 * interleave. These drive two at once through the same seam the bridge uses,
 * and each one fails if the queue is taken out.
 */

const GRANT: BrowserCommandIssuer = {
  kind: "grant",
  grantId: "grant_1",
  label: "Claude Code",
  level: "interact",
};
const OTHER: BrowserCommandIssuer = {
  kind: "grant",
  grantId: "grant_2",
  label: "Codex",
  level: "interact",
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function ownedBy(entries: Array<[string, BrowserCommandIssuer]>) {
  return new Map(entries) as BrowserTabOwners;
}

describe("two commands on one browser", () => {
  it("does not start the second one on a tab while the first is reading it", async () => {
    const gate = deferred();
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a", "https://example.com/")] },
      live: { a: liveState("a") },
      queue: createBrowserTabQueue(),
      readPageGate: gate.promise,
    });

    const read = executeBrowserCommand(
      { type: "page.get_text", tabId: "a", maxLength: 1000, selector: null },
      harness.deps,
    );
    const navigate = executeBrowserCommand(
      {
        type: "navigation.open",
        tabId: "a",
        url: "https://elsewhere.example/",
        newTab: false,
      },
      harness.deps,
    );

    // The failure this is against: the read is still in the air and the page
    // under it has already been replaced, so what comes back describes a page
    // the caller never asked about.
    await Promise.resolve();
    expect(harness.calls.navigate).toEqual([]);
    gate.resolve();
    const [readOutcome] = await Promise.all([read, navigate]);
    expect(readOutcome).toMatchObject({ ok: true });
    expect(harness.calls.navigate).toHaveLength(1);
  });

  it("lets two callers work at once when they are in different tabs", async () => {
    const gate = deferred();
    const harness = createHarness({
      state: {
        activeTabId: "a",
        tabs: [
          tab("a", "https://example.com/"),
          tab("b", "https://other.example/"),
        ],
      },
      live: { a: liveState("a"), b: liveState("b") },
      queue: createBrowserTabQueue(),
      readPageGate: gate.promise,
      owners: ownedBy([
        ["a", GRANT],
        ["b", OTHER],
      ]),
      issuer: GRANT,
    });

    const read = executeBrowserCommand(
      { type: "page.get_text", tabId: "a", maxLength: 1000, selector: null },
      harness.deps,
    );
    await executeBrowserCommand(
      {
        type: "navigation.open",
        tabId: "b",
        url: "https://elsewhere.example/",
        newTab: false,
      },
      // A different caller, in its own tab. Ownership exists so this can happen
      // at all; a queue over the whole window would have taken it back.
      { ...harness.deps, issuer: OTHER },
    );

    expect(harness.calls.navigate).toHaveLength(1);
    gate.resolve();
    await read;
  });

  it("does not make a refusal wait for the tab it was refused", async () => {
    const gate = deferred();
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a", "https://example.com/")] },
      live: { a: liveState("a") },
      queue: createBrowserTabQueue(),
      readPageGate: gate.promise,
      owners: ownedBy([["a", OTHER]]),
      issuer: GRANT,
    });

    const read = executeBrowserCommand(
      { type: "page.get_text", tabId: "a", maxLength: 1000, selector: null },
      { ...harness.deps, issuer: OTHER },
    );
    const refused = await executeBrowserCommand(
      { type: "page.get_text", tabId: "a", maxLength: 1000, selector: null },
      harness.deps,
    );

    // Nothing happened to the page, so there was nothing to take turns over —
    // and an agent left waiting on a queue for an answer it was never going to
    // get would look like the browser had hung.
    expect(refused).toMatchObject({ ok: false, code: "tab_not_yours" });
    gate.resolve();
    await read;
  });
});
