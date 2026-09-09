import { describe, expect, it } from "vitest";
import type { BrowserFixedPanelTab } from "./fixed-panel-tabs-state";
import {
  activateBrowserSurfaceTab,
  addBrowserSurfaceTab,
  closeBrowserSurfaceTab,
  duplicateBrowserSurfaceTab,
  EMPTY_BROWSER_SURFACE_TABS_STATE,
  getActiveBrowserSurfaceTab,
  isPinnedSurfaceTab,
  MAX_CLOSED_BROWSER_SURFACE_TABS,
  moveBrowserSurfaceTab,
  parseBrowserSurfaceTabsState,
  pushClosedBrowserSurfaceTab,
  reopenBrowserSurfaceTab,
  setBrowserSurfaceTabPinned,
  updateBrowserSurfaceTab,
  type BrowserSurfaceTabsState,
  type ClosedBrowserSurfaceTab,
} from "./browser-surface-tabs";

function tab(id: string, url = ""): BrowserFixedPanelTab {
  return { environmentId: null, id, kind: "browser", title: null, url };
}

function stateWith(ids: readonly string[], activeTabId: string | null) {
  return { activeTabId, tabs: ids.map((id) => tab(id)) };
}

describe("browser surface tabs", () => {
  it("appends a new tab and focuses it", () => {
    const first = addBrowserSurfaceTab(
      EMPTY_BROWSER_SURFACE_TABS_STATE,
      tab("a"),
    );
    const second = addBrowserSurfaceTab(first, tab("b"));

    expect(second.tabs.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(second.activeTabId).toBe("b");
  });

  it("focuses an already-open tab instead of duplicating it", () => {
    const state = stateWith(["a", "b"], "b");

    const next = addBrowserSurfaceTab(state, tab("a"));

    expect(next.tabs.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(next.activeTabId).toBe("a");
  });

  // Closing the focused tab must land somewhere predictable, or the surface
  // shows an unrelated page.
  it("hands focus to the right-hand neighbour when closing the active tab", () => {
    const next = closeBrowserSurfaceTab(stateWith(["a", "b", "c"], "b"), "b");

    expect(next.tabs.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(next.activeTabId).toBe("c");
  });

  it("falls back to the left-hand neighbour when closing the last tab", () => {
    const next = closeBrowserSurfaceTab(stateWith(["a", "b"], "b"), "b");

    expect(next.activeTabId).toBe("a");
  });

  it("keeps focus when closing an inactive tab", () => {
    const next = closeBrowserSurfaceTab(stateWith(["a", "b", "c"], "a"), "c");

    expect(next.tabs.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(next.activeTabId).toBe("a");
  });

  it("clears focus when the last tab closes", () => {
    const next = closeBrowserSurfaceTab(stateWith(["a"], "a"), "a");

    expect(next.tabs).toEqual([]);
    expect(next.activeTabId).toBeNull();
  });

  it("ignores closing and activating unknown tabs", () => {
    const state = stateWith(["a"], "a");

    expect(closeBrowserSurfaceTab(state, "missing")).toBe(state);
    expect(activateBrowserSurfaceTab(state, "missing")).toBe(state);
  });

  it("records navigation results on the addressed tab only", () => {
    const next = updateBrowserSurfaceTab(stateWith(["a", "b"], "a"), {
      tabId: "a",
      title: "Example",
      url: "https://example.test/",
    });

    expect(next.tabs[0]).toMatchObject({
      title: "Example",
      url: "https://example.test/",
    });
    expect(next.tabs[1]).toMatchObject({ title: null, url: "" });
  });

  // The native view pushes navigation state on every event; identity-stable
  // no-ops keep React from re-rendering the whole strip on each one.
  it("returns the same state when an update changes nothing", () => {
    const state: BrowserSurfaceTabsState = {
      activeTabId: "a",
      tabs: [{ ...tab("a", "https://example.test/"), title: "Example" }],
    };

    expect(
      updateBrowserSurfaceTab(state, {
        tabId: "a",
        title: "Example",
        url: "https://example.test/",
      }),
    ).toBe(state);
  });

  it("leaves untouched fields alone when only one is supplied", () => {
    const state: BrowserSurfaceTabsState = {
      activeTabId: "a",
      tabs: [{ ...tab("a", "https://example.test/"), title: "Example" }],
    };

    const next = updateBrowserSurfaceTab(state, { tabId: "a", title: null });

    expect(next.tabs[0]).toMatchObject({
      title: null,
      url: "https://example.test/",
    });
  });

  it("resolves the active tab, or null when focus is empty", () => {
    expect(getActiveBrowserSurfaceTab(stateWith(["a", "b"], "b"))?.id).toBe(
      "b",
    );
    expect(
      getActiveBrowserSurfaceTab(EMPTY_BROWSER_SURFACE_TABS_STATE),
    ).toBeNull();
  });
});

// Cmd/Ctrl+click, the middle button, "Open link in new tab". The tab has to
// land beside the page the link was on: at the far end of the strip it is a tab
// the user has to go find, which is the opposite of what queueing a link is for.
describe("browser surface tabs opened from a page", () => {
  it("puts a link's tab directly behind the page it was opened from", () => {
    const state = stateWith(["a", "b", "c"], "a");

    const opened = addBrowserSurfaceTab(state, tab("link"), {
      openerTabId: "a",
    });

    expect(opened.tabs.map((entry) => entry.id)).toEqual([
      "a",
      "link",
      "b",
      "c",
    ]);
    // Where focus goes is the caller's; the reducer focuses what it adds, and
    // the hook puts focus back for a background tab.
    expect(opened.activeTabId).toBe("link");
  });

  it("queues links from one page in the order they were clicked", () => {
    const first = addBrowserSurfaceTab(stateWith(["a", "b"], "a"), tab("1"), {
      openerTabId: "a",
    });
    const second = addBrowserSurfaceTab(first, tab("2"), { openerTabId: "a" });
    const third = addBrowserSurfaceTab(second, tab("3"), { openerTabId: "a" });

    expect(third.tabs.map((entry) => entry.id)).toEqual([
      "a",
      "1",
      "2",
      "3",
      "b",
    ]);
  });

  // The run behind an opener is that opener's own, so a queued link stops at
  // the first tab that came from somewhere else rather than jumping over it.
  it("stops the run at a tab another page opened", () => {
    const state = {
      activeTabId: "a",
      tabs: [
        tab("a"),
        { ...tab("mine"), openerTabId: "a" },
        { ...tab("theirs"), openerTabId: "b" },
      ],
    };

    const opened = addBrowserSurfaceTab(state, tab("next"), {
      openerTabId: "a",
    });

    expect(opened.tabs.map((entry) => entry.id)).toEqual([
      "a",
      "mine",
      "next",
      "theirs",
    ]);
    // Recorded on the tab, which is what the next link from the same page reads
    // to find the end of the run.
    expect(opened.tabs[2]).toMatchObject({ id: "next", openerTabId: "a" });
  });

  // The pinned block is a block: a link from a pinned page cannot land inside
  // it, so it lands at the head of the unpinned one — Chromium's behaviour.
  it("lands a link from a pinned page at the head of the unpinned block", () => {
    const first = setBrowserSurfaceTabPinned(stateWith(["a", "b", "c"], "a"), {
      pinned: true,
      tabId: "a",
    });
    const pinned = setBrowserSurfaceTabPinned(first, {
      pinned: true,
      tabId: "b",
    });

    const opened = addBrowserSurfaceTab(pinned, tab("link"), {
      openerTabId: "a",
    });

    expect(opened.tabs.map((entry) => entry.id)).toEqual([
      "a",
      "b",
      "link",
      "c",
    ]);
    expect(
      opened.tabs.filter(isPinnedSurfaceTab).map((entry) => entry.id),
    ).toEqual(["a", "b"]);
  });

  // A pinned page's links cannot sit next to it — the pinned block is a block —
  // so they queue at the head of the unpinned one. Anchoring the queue on the
  // opener's own index instead put each new link ahead of the last, which is
  // the backwards queue this whole placement exists to avoid.
  it("queues links from a pinned page in order behind the pinned block", () => {
    const first = setBrowserSurfaceTabPinned(stateWith(["a", "b", "c"], "a"), {
      pinned: true,
      tabId: "a",
    });
    const pinned = setBrowserSurfaceTabPinned(first, {
      pinned: true,
      tabId: "b",
    });

    const one = addBrowserSurfaceTab(pinned, tab("1"), { openerTabId: "a" });
    const two = addBrowserSurfaceTab(one, tab("2"), { openerTabId: "a" });

    expect(two.tabs.map((entry) => entry.id)).toEqual([
      "a",
      "b",
      "1",
      "2",
      "c",
    ]);
    expect(
      two.tabs.filter(isPinnedSurfaceTab).map((entry) => entry.id),
    ).toEqual(["a", "b"]);
  });

  // Two pinned pages share that head, so a queue steps over the other's tabs
  // rather than stopping at them: what has to hold is that each page's own
  // links stay in the order they were clicked.
  it("keeps two pinned pages' queues in their own order", () => {
    const first = setBrowserSurfaceTabPinned(stateWith(["a", "b", "c"], "a"), {
      pinned: true,
      tabId: "a",
    });
    const pinned = setBrowserSurfaceTabPinned(first, {
      pinned: true,
      tabId: "b",
    });

    const fromA = addBrowserSurfaceTab(pinned, tab("a1"), { openerTabId: "a" });
    const fromB = addBrowserSurfaceTab(fromA, tab("b1"), { openerTabId: "b" });
    const both = addBrowserSurfaceTab(fromB, tab("a2"), { openerTabId: "a" });

    const ids = both.tabs.map((entry) => entry.id);
    expect(ids.indexOf("a1")).toBeLessThan(ids.indexOf("a2"));
    expect(ids.indexOf("b1")).toBeLessThan(ids.indexOf("a1"));
    expect(ids.at(-1)).toBe("c");
  });

  it("appends when the opener has left the strip", () => {
    const opened = addBrowserSurfaceTab(
      stateWith(["a", "b"], "a"),
      tab("link"),
      { openerTabId: "gone" },
    );

    expect(opened.tabs.map((entry) => entry.id)).toEqual(["a", "b", "link"]);
    // No opener recorded either: the id names nothing this strip can place the
    // next link behind.
    expect(Object.hasOwn(opened.tabs[2] ?? {}, "openerTabId")).toBe(false);
  });
});

describe("pinned browser surface tabs", () => {
  it("moves a pinned tab to the leading block", () => {
    const pinned = setBrowserSurfaceTabPinned(stateWith(["a", "b", "c"], "a"), {
      pinned: true,
      tabId: "c",
    });

    expect(pinned.tabs.map((entry) => entry.id)).toEqual(["c", "a", "b"]);
    expect(
      pinned.tabs.filter(isPinnedSurfaceTab).map((entry) => entry.id),
    ).toEqual(["c"]);
    // Pinning is not selecting: the strip reorders under whatever was active.
    expect(pinned.activeTabId).toBe("a");
  });

  it("keeps pinned tabs together as more are pinned", () => {
    const first = setBrowserSurfaceTabPinned(stateWith(["a", "b", "c"], "a"), {
      pinned: true,
      tabId: "b",
    });
    const second = setBrowserSurfaceTabPinned(first, {
      pinned: true,
      tabId: "c",
    });

    expect(second.tabs.map((entry) => entry.id)).toEqual(["b", "c", "a"]);
  });

  // Chromium's rule: an unpinned tab lands at the head of the unpinned block,
  // which is where it already is once the pinned ones are ahead of it.
  it("returns an unpinned tab to the unpinned block", () => {
    const pinned = setBrowserSurfaceTabPinned(stateWith(["a", "b", "c"], "a"), {
      pinned: true,
      tabId: "b",
    });
    const unpinned = setBrowserSurfaceTabPinned(pinned, {
      pinned: false,
      tabId: "b",
    });

    expect(unpinned.tabs.map((entry) => entry.id)).toEqual(["b", "a", "c"]);
    expect(unpinned.tabs.some(isPinnedSurfaceTab)).toBe(false);
    // Written the way a build without pinning would have written it, so the flag
    // does not travel to storage as `false`.
    expect(Object.hasOwn(unpinned.tabs[0] ?? {}, "pinned")).toBe(false);
  });

  it("ignores a flag that already matches, and an unknown tab", () => {
    const state = stateWith(["a", "b"], "a");

    expect(
      setBrowserSurfaceTabPinned(state, { pinned: false, tabId: "a" }),
    ).toBe(state);
    expect(
      setBrowserSurfaceTabPinned(state, { pinned: true, tabId: "gone" }),
    ).toBe(state);
  });
});

describe("moved browser surface tabs", () => {
  it("moves a tab right and left, leaving focus alone", () => {
    const state = stateWith(["a", "b", "c"], "a");

    const right = moveBrowserSurfaceTab(state, { tabId: "a", toIndex: 2 });
    expect(right.tabs.map((tab) => tab.id)).toEqual(["b", "c", "a"]);
    expect(right.activeTabId).toBe("a");

    const left = moveBrowserSurfaceTab(right, { tabId: "a", toIndex: 0 });
    expect(left.tabs.map((tab) => tab.id)).toEqual(["a", "b", "c"]);
  });

  // The pinned block is a prefix, so an unpinned tab asked for position 0 goes as
  // far left as it can — the head of its own block — rather than into the pinned
  // one.
  it("clamps a move into the tab's own block", () => {
    const pinned = setBrowserSurfaceTabPinned(stateWith(["a", "b", "c"], "a"), {
      pinned: true,
      tabId: "a",
    });

    const up = moveBrowserSurfaceTab(pinned, { tabId: "c", toIndex: 0 });
    expect(up.tabs.map((tab) => tab.id)).toEqual(["a", "c", "b"]);

    // And the pinned tab cannot be pushed out of the block it leads.
    const down = moveBrowserSurfaceTab(up, { tabId: "a", toIndex: 2 });
    expect(down).toBe(up);
  });

  it("ignores a move that changes nothing, and an unknown tab", () => {
    const state = stateWith(["a", "b"], "a");

    expect(moveBrowserSurfaceTab(state, { tabId: "a", toIndex: 0 })).toBe(
      state,
    );
    expect(moveBrowserSurfaceTab(state, { tabId: "gone", toIndex: 1 })).toBe(
      state,
    );
  });
});

describe("duplicated browser surface tabs", () => {
  it("puts the copy beside its source and focuses it", () => {
    const state = stateWith(["a", "b"], "a");

    const duplicated = duplicateBrowserSurfaceTab(state, {
      sourceTabId: "a",
      tab: tab("copy", "https://example.test/"),
    });

    expect(duplicated.tabs.map((entry) => entry.id)).toEqual([
      "a",
      "copy",
      "b",
    ]);
    expect(duplicated.activeTabId).toBe("copy");
  });

  it("pins the copy of a pinned tab, so the pinned block stays whole", () => {
    const pinned = setBrowserSurfaceTabPinned(stateWith(["a", "b"], "a"), {
      pinned: true,
      tabId: "a",
    });

    const duplicated = duplicateBrowserSurfaceTab(pinned, {
      sourceTabId: "a",
      tab: tab("copy"),
    });

    expect(duplicated.tabs.map((entry) => entry.id)).toEqual([
      "a",
      "copy",
      "b",
    ]);
    expect(isPinnedSurfaceTab(duplicated.tabs[1] as never)).toBe(true);
  });

  it("ignores an unknown source and an id already in the strip", () => {
    const state = stateWith(["a", "b"], "a");

    expect(
      duplicateBrowserSurfaceTab(state, {
        sourceTabId: "gone",
        tab: tab("copy"),
      }),
    ).toBe(state);
    expect(
      duplicateBrowserSurfaceTab(state, { sourceTabId: "a", tab: tab("b") }),
    ).toBe(state);
  });
});

describe("browser surface tab persistence", () => {
  const fallback = { activeTabId: "fallback", tabs: [tab("fallback")] };

  it("restores a stored surface", () => {
    const stored = JSON.stringify(stateWith(["a", "b"], "b"));

    const parsed = parseBrowserSurfaceTabsState(stored, fallback);

    expect(parsed.tabs.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(parsed.activeTabId).toBe("b");
  });

  it("restores which page opened a tab", () => {
    const stored = JSON.stringify({
      activeTabId: "link",
      tabs: [tab("a"), { ...tab("link"), openerTabId: "a" }],
    });

    const parsed = parseBrowserSurfaceTabsState(stored, fallback);

    expect(parsed.tabs[1]).toMatchObject({ id: "link", openerTabId: "a" });
  });

  it("restores which tabs were pinned", () => {
    const stored = JSON.stringify(
      setBrowserSurfaceTabPinned(stateWith(["a", "b"], "b"), {
        pinned: true,
        tabId: "b",
      }),
    );

    const parsed = parseBrowserSurfaceTabsState(stored, fallback);

    expect(parsed.tabs.map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(
      parsed.tabs.filter(isPinnedSurfaceTab).map((entry) => entry.id),
    ).toEqual(["b"]);
  });

  it("falls back for missing, malformed and schema-invalid values", () => {
    expect(parseBrowserSurfaceTabsState(null, fallback)).toBe(fallback);
    expect(parseBrowserSurfaceTabsState("{not json", fallback)).toBe(fallback);
    expect(
      parseBrowserSurfaceTabsState(JSON.stringify({ tabs: "nope" }), fallback),
    ).toBe(fallback);
    expect(
      parseBrowserSurfaceTabsState(
        JSON.stringify({ activeTabId: null, tabs: [{ id: "a" }] }),
        fallback,
      ),
    ).toBe(fallback);
  });

  // A store naming a tab that is gone would otherwise render an empty surface
  // while the strip still shows tabs.
  it("repoints a stale active id at a surviving tab", () => {
    const parsed = parseBrowserSurfaceTabsState(
      JSON.stringify({ activeTabId: "gone", tabs: [tab("a"), tab("b")] }),
      fallback,
    );

    expect(parsed.activeTabId).toBe("b");
  });
});

describe("closed browser surface tabs", () => {
  function tabAt(id: string, url: string): BrowserFixedPanelTab {
    return { environmentId: null, id, kind: "browser", title: null, url };
  }

  const state: BrowserSurfaceTabsState = {
    activeTabId: "b",
    tabs: [tabAt("a", "https://a.test/"), tabAt("b", "https://b.test/")],
  };

  it("keeps the most recent closes, newest first", () => {
    let stack = pushClosedBrowserSurfaceTab([], {
      index: 0,
      tab: tabAt("a", "https://a.test/"),
    });
    stack = pushClosedBrowserSurfaceTab(stack, {
      index: 1,
      tab: tabAt("b", "https://b.test/"),
    });

    expect(stack.map((closed) => closed.tab.id)).toEqual(["b", "a"]);
  });

  it("bounds the stack", () => {
    let stack: readonly ClosedBrowserSurfaceTab[] = [];
    for (let index = 0; index < 14; index += 1) {
      stack = pushClosedBrowserSurfaceTab(stack, {
        index,
        tab: tabAt(`tab-${index}`, "https://a.test/"),
      });
    }

    expect(stack).toHaveLength(MAX_CLOSED_BROWSER_SURFACE_TABS);
    expect(stack[0]?.tab.id).toBe("tab-13");
  });

  // Chromium puts a reopened tab back where it was, not at the end.
  it("reopens a tab at its original index and focuses it", () => {
    const closed = { index: 0, tab: tabAt("gone", "https://gone.test/") };

    const next = reopenBrowserSurfaceTab(state, closed);

    expect(next.tabs.map((tab) => tab.id)).toEqual(["gone", "a", "b"]);
    expect(next.activeTabId).toBe("gone");
  });

  // The id is what the shell stored the page's history and scroll under, so a
  // reopened tab must be the *same* tab, not a copy of it.
  it("reopens under the id the shell knows", () => {
    const closed = { index: 1, tab: tabAt("gone", "https://gone.test/") };

    expect(reopenBrowserSurfaceTab(state, closed).tabs[1]?.id).toBe("gone");
  });

  it("clamps an index past the end rather than dropping the tab", () => {
    const closed = { index: 9, tab: tabAt("gone", "https://gone.test/") };

    expect(
      reopenBrowserSurfaceTab(state, closed).tabs.map((tab) => tab.id),
    ).toEqual(["a", "b", "gone"]);
  });

  it("only focuses a tab that is somehow already open", () => {
    const closed = { index: 0, tab: tabAt("a", "https://a.test/") };

    const next = reopenBrowserSurfaceTab(state, closed);

    expect(next.tabs).toHaveLength(2);
    expect(next.activeTabId).toBe("a");
  });
});
