import { describe, expect, it } from "vitest";
import type { BrowserCommandIssuer } from "@patcher/server-contract";
import { createHarness, liveState, tab } from "@/test/browser-command-harness";
import { BrowserTraceRecorder } from "./trace";
import { executeBrowserCommand } from "./execute";
import { createBrowserTabQueue } from "./tab-queue";
import type { BrowserTabOwners } from "./tab-owners";

/**
 * Whose tab a command lands on.
 *
 * The rule is asymmetric — a turn may use the person's tab, a caller outside
 * Patcher may not — and the asymmetry is the point rather than an accident, so
 * each half is here. What makes these worth writing is that the failure they
 * guard is silent: before ownership, every one of these commands succeeded, on
 * the tab the person was reading.
 */

const GRANT: BrowserCommandIssuer = {
  kind: "grant",
  grantId: "grant_1",
  label: "Claude Code",
  level: "interact",
};
const OTHER_GRANT: BrowserCommandIssuer = {
  kind: "grant",
  grantId: "grant_2",
  label: "Codex",
  level: "read",
};
const TURN: BrowserCommandIssuer = { kind: "thread", threadId: "thread_1" };

function ownedBy(entries: Array<[string, BrowserCommandIssuer]>) {
  return new Map(entries) as BrowserTabOwners;
}

describe("tab ownership", () => {
  it("sends an unqualified command to the caller's own newest tab", async () => {
    const harness = createHarness({
      // The person is looking at "a"; the grant opened "b" and then "c".
      state: {
        activeTabId: "a",
        tabs: [
          tab("a", "https://person.example/"),
          tab("b", "https://first.example/"),
          tab("c", "https://second.example/"),
        ],
      },
      issuer: GRANT,
      owners: ownedBy([
        ["b", GRANT],
        ["c", GRANT],
      ]),
    });

    const outcome = await executeBrowserCommand(
      { type: "page.get_url", tabId: null },
      harness.deps,
    );

    expect(outcome).toEqual({
      ok: true,
      value: { type: "url", url: "https://second.example/" },
    });
  });

  it("tells a caller outside Patcher to open a tab rather than borrowing one", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a", "https://person.example/")] },
      issuer: GRANT,
    });

    const outcome = await executeBrowserCommand(
      { type: "page.get_url", tabId: null },
      harness.deps,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("the person's tab was handed over");
    expect(outcome.code).toBe("no_active_tab");
    // The sentence has to say both halves, or the agent retries the same call:
    // there *is* a tab, and it is not this caller's.
    expect(outcome.message).toContain("of your own");
    // What it may not do is send them to ask for a handover: no tab was named,
    // so nothing was asked for, and a turn reaches this line only for a tab
    // that is another agent's — which the person cannot give away.
    expect(outcome.message).not.toContain("hand");
    expect(harness.calls.handoverAsks).toEqual([]);
  });

  it("lets a turn read the tab the person is looking at", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a", "https://person.example/")] },
      issuer: TURN,
    });

    const outcome = await executeBrowserCommand(
      { type: "page.get_url", tabId: null },
      harness.deps,
    );

    // The case the in-app tools exist for. If this ever starts refusing, the
    // browser tools stopped being able to answer "what am I looking at".
    expect(outcome).toEqual({
      ok: true,
      value: { type: "url", url: "https://person.example/" },
    });
  });

  it("prefers a turn's own tab over the person's once it has one", async () => {
    const harness = createHarness({
      state: {
        activeTabId: "a",
        tabs: [
          tab("a", "https://person.example/"),
          tab("b", "https://mine.example/"),
        ],
      },
      issuer: TURN,
      owners: ownedBy([["b", TURN]]),
    });

    const outcome = await executeBrowserCommand(
      { type: "page.get_url", tabId: null },
      harness.deps,
    );

    // Otherwise opening a background tab and reading it — the sequence the
    // tools recommend — reads the user's page instead of the one just opened.
    expect(outcome).toEqual({
      ok: true,
      value: { type: "url", url: "https://mine.example/" },
    });
  });

  it("does not hand a turn another agent's tab for being the active one", async () => {
    const harness = createHarness({
      // The grant activated its own tab, or the person clicked onto it. Either
      // way it is now "the active tab", which is what the fallback used to take
      // without asking whose it was.
      state: {
        activeTabId: "b",
        tabs: [
          tab("a", "https://person.example/"),
          tab("b", "https://theirs.example/"),
        ],
      },
      issuer: TURN,
      owners: ownedBy([["b", GRANT]]),
    });

    const outcome = await executeBrowserCommand(
      { type: "page.get_url", tabId: null },
      harness.deps,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("the fallback skipped the rule");
    expect(outcome.code).toBe("no_active_tab");
    expect(outcome.message).toContain("not yours to work in");
  });

  it("refuses the person's tab by name, and asks them for it", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a", "https://person.example/")] },
      issuer: GRANT,
      // The bridge's shape, because the ask is raised from a path this harness
      // otherwise skips: a command is placed in its tab's queue, and placing it
      // resolves its tab.
      queue: createBrowserTabQueue(),
    });

    const outcome = await executeBrowserCommand(
      { type: "navigation.reload", tabId: "a" },
      harness.deps,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("naming a tab bypassed the rule");
    expect(outcome.code).toBe("tab_not_yours");
    expect(outcome.message).toContain("the person at this machine");
    // Refusing without asking leaves the person nothing to press — and asking
    // once, however many times the command resolves its tab: a queued command
    // resolves it twice more, and each resolve used to ask.
    expect(harness.calls.handoverAsks).toEqual([{ issuer: GRANT, tabId: "a" }]);
    // The asking has happened, so the sentence may not send the agent to do it:
    // that was an errand whose only effect had already occurred, and it left the
    // agent with nothing to wait on.
    expect(outcome.message).toContain("Naming it is what asks them for it");
    expect(outcome.message).not.toContain("hand this one over");
    // And it promises no row on screen — the chrome that draws one is not
    // mounted while the person reads a thread — only that naming it again is
    // what puts the ask back.
    expect(outcome.message).toContain("name it again");
    expect(harness.calls.reload).toEqual([]);
  });

  it("refuses another agent's tab to everyone, and asks nobody for it", async () => {
    const harness = createHarness({
      state: {
        activeTabId: "a",
        tabs: [tab("a"), tab("b", "https://theirs.example/")],
      },
      issuer: TURN,
      owners: ownedBy([["b", OTHER_GRANT]]),
    });

    const outcome = await executeBrowserCommand(
      { type: "navigation.reload", tabId: "b" },
      harness.deps,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("a turn took another agent's tab");
    expect(outcome.code).toBe("tab_not_yours");
    expect(outcome.message).toContain("another agent");
    // Nor is this caller sent to ask for it. The person can take a tab back
    // from the strip's menu but cannot give one away, so the errand had no
    // destination — the same defect as the person branch, one case over.
    expect(outcome.message).not.toContain("hand this one over");
    // But not *which* agent: the label is the name a person gave a credential,
    // and this sentence is read by a different caller. Found by review.
    expect(outcome.message).not.toContain("Codex");
    // The person cannot answer this one: it is not their tab to give.
    expect(harness.calls.handoverAsks).toEqual([]);
  });

  it("answers any tab's address and title, and asks nobody for them", async () => {
    const harness = createHarness({
      state: {
        activeTabId: "a",
        tabs: [
          tab("a", "https://person.example/"),
          tab("b", "https://theirs.example/"),
        ],
      },
      // Live state is what the listing prefers, so it is what these two have
      // to agree with — a stale strip entry would let this pass by accident.
      live: {
        a: liveState("a", {
          url: "https://person.example/inbox",
          title: "The person's inbox",
        }),
      },
      issuer: GRANT,
      owners: ownedBy([["b", OTHER_GRANT]]),
      queue: createBrowserTabQueue(),
    });

    const url = await executeBrowserCommand(
      { type: "page.get_url", tabId: "a" },
      harness.deps,
    );
    const title = await executeBrowserCommand(
      { type: "page.get_title", tabId: "a" },
      harness.deps,
    );
    // Another agent's, which no handover can ever open: if this refused, the
    // rule would be about the tab rather than about acting.
    const other = await executeBrowserCommand(
      { type: "page.get_url", tabId: "b" },
      harness.deps,
    );
    const listed = await executeBrowserCommand(
      { type: "tabs.list" },
      harness.deps,
    );

    expect(url).toEqual({
      ok: true,
      value: { type: "url", url: "https://person.example/inbox" },
    });
    expect(title).toEqual({
      ok: true,
      value: { type: "title", title: "The person's inbox" },
    });
    expect(other).toEqual({
      ok: true,
      value: { type: "url", url: "https://theirs.example/" },
    });
    // The argument in one assertion: this is the same field, from the same
    // record, at the same `tabs.read` price the listing is charged.
    expect(listed).toMatchObject({
      ok: true,
      value: {
        tabs: [
          { tabId: "a", url: "https://person.example/inbox", owner: "person" },
          { tabId: "b", url: "https://theirs.example/", owner: "agent" },
        ],
      },
    });
    // What must not happen: a question on the person's screen for something the
    // caller could already read off that listing.
    expect(harness.calls.handoverAsks).toEqual([]);
  });

  it("still refuses to read into a page that is not the caller's", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a", "https://person.example/")] },
      live: { a: liveState("a") },
      issuer: GRANT,
      queue: createBrowserTabQueue(),
    });

    // The line the address and the title are on the other side of: the page
    // itself. Reading it is acting in their tab, and asking for it is the ask.
    const text = await executeBrowserCommand(
      { type: "page.get_text", tabId: "a", maxLength: 1000, selector: null },
      harness.deps,
    );

    expect(text).toMatchObject({ ok: false, code: "tab_not_yours" });
    expect(harness.calls.handoverAsks).toEqual([{ issuer: GRANT, tabId: "a" }]);
    expect(harness.calls.readPageIn).toEqual([]);
  });

  it("claims a tab for whoever opened it", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      issuer: GRANT,
    });

    const outcome = await executeBrowserCommand(
      { type: "tabs.open", url: "https://example.com", activate: false },
      harness.deps,
    );

    if (!outcome.ok) throw new Error("the open failed");
    expect(outcome.value).toMatchObject({
      type: "tab",
      tab: { tabId: "new-1", owner: "you" },
    });
    expect(harness.getOwners().get("new-1")).toEqual(GRANT);
  });

  it("says whose each tab is in the listing", async () => {
    const harness = createHarness({
      state: {
        activeTabId: "a",
        tabs: [tab("a"), tab("b"), tab("c")],
      },
      issuer: GRANT,
      owners: ownedBy([
        ["b", GRANT],
        ["c", OTHER_GRANT],
      ]),
    });

    const outcome = await executeBrowserCommand(
      { type: "tabs.list" },
      harness.deps,
    );

    if (!outcome.ok || outcome.value.type !== "tabs") {
      throw new Error("the listing failed");
    }
    // Relative to the caller: the same three tabs answer differently to Codex.
    expect(outcome.value.tabs.map((each) => [each.tabId, each.owner])).toEqual([
      ["a", "person"],
      ["b", "you"],
      ["c", "agent"],
    ]);
  });

  it("drops a claim when the tab closes, and the stale ones with it", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a"), tab("b")] },
      issuer: GRANT,
      owners: ownedBy([
        ["b", GRANT],
        // A tab the person closed themselves: nothing tells the executor, so
        // this entry can only go on the next write.
        ["gone", GRANT],
      ]),
    });

    await executeBrowserCommand(
      { type: "tabs.close", tabId: "b" },
      harness.deps,
    );

    expect([...harness.getOwners().keys()]).toEqual([]);
  });

  it("keeps the person's screen out of an outside caller's trace", async () => {
    // The trace screenshots the *active* tab, because a background view has
    // nothing composited. So a caller working in its own background tab would
    // have collected a picture of the person's page with every step — the same
    // page it is refused by name, arriving another way.
    const harness = createHarness({
      state: {
        activeTabId: "a",
        tabs: [tab("a", "https://person.example/"), tab("b")],
      },
      issuer: GRANT,
      owners: ownedBy([["b", GRANT]]),
      live: { a: liveState("a"), b: liveState("b") },
      trace: new BrowserTraceRecorder(),
      observe: {
        ok: true,
        kind: "screenshot",
        tabId: "a",
        url: "https://person.example/",
        title: "The person's page",
        mimeType: "image/jpeg",
        base64: "AAAA",
        width: 800,
        height: 600,
      },
    });
    await executeBrowserCommand(
      {
        type: "page.record",
        tabId: "b",
        operation: { kind: "trace-start", screenshots: true },
      },
      harness.deps,
    );

    await executeBrowserCommand(
      { type: "navigation.reload", tabId: "b" },
      harness.deps,
    );
    const stopped = await executeBrowserCommand(
      { type: "page.record", tabId: "b", operation: { kind: "trace-stop" } },
      harness.deps,
    );
    expect(stopped).toMatchObject({
      ok: true,
      value: { steps: [{ command: "navigation.reload", image: null }] },
    });
    // Not even asked for: a refusal that still takes the picture is not a
    // refusal.
    expect(harness.calls.observations).toEqual([]);
  });

  it("changes nothing for a command nobody is named on", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a", "https://person.example/")] },
      live: { a: liveState("a") },
      owners: ownedBy([["a", OTHER_GRANT]]),
    });

    const outcome = await executeBrowserCommand(
      { type: "navigation.reload", tabId: "a" },
      harness.deps,
    );

    // The app's own work, and the work a plugin does by itself, arrive with no
    // issuer. Binding them would refuse commands nobody asked for — there is no
    // caller to own a tab on behalf of. An acting command, because a tab's
    // address answers for every caller now and would pass this either way.
    expect(outcome).toMatchObject({ ok: true });
    expect(harness.calls.reload).toEqual(["a"]);
  });
});
