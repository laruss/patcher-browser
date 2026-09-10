import { createStore } from "jotai";
import { browserSurfaceTabsAtom } from "@/lib/browser-surface-tabs";
import { createBrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { describe, expect, it } from "vitest";
import type { BrowserCommandIssuer } from "@patcher/server-contract";
import {
  EMPTY_BROWSER_TAB_OWNERS,
  browserTabHandoverAskAtom,
  browserTabOwnerFor,
  mayActOnBrowserTab,
  newestBrowserTabOwnedBy,
  parseBrowserTabOwners,
  requestBrowserTabHandoverAtom,
  withBrowserTabOwner,
  type BrowserTabClaim,
  type BrowserTabClaimMode,
  type BrowserTabOwners,
} from "./tab-owners";

/**
 * The bookkeeping under the ownership rule.
 *
 * The rule itself is exercised end to end in `execute.test.ts`, where it can be
 * seen refusing a real command. What is here is what that cannot show: the
 * order the map keeps, which decides what "my newest tab" means, and the
 * storage round trip, which is why an agent still owns its tab after a reload.
 */

const GRANT: BrowserCommandIssuer = {
  kind: "grant",
  grantId: "grant_1",
  label: "Claude Code",
  level: "read",
};
const RENAMED: BrowserCommandIssuer = { ...GRANT, label: "Claude, at work" };
const OTHER: BrowserCommandIssuer = { ...GRANT, grantId: "grant_2" };
const TURN: BrowserCommandIssuer = { kind: "thread", threadId: "thread_1" };

/**
 * "May this caller act in that tab", which is the question the rule was for
 * before a price came into it. `page.interact` stands for acting: it is the
 * cheapest thing a look claim refuses.
 */
function act(args: {
  claim: BrowserTabClaim | undefined;
  issuer: BrowserCommandIssuer;
}): boolean {
  return mayActOnBrowserTab({ ...args, need: "page.interact" });
}

function claim(
  owners: BrowserTabOwners,
  tabId: string,
  issuer: BrowserCommandIssuer | null,
  openTabIds: readonly string[],
  mode: BrowserTabClaimMode = "drive",
): BrowserTabOwners {
  return withBrowserTabOwner(owners, {
    claim: issuer === null ? null : { issuer, mode },
    openTabIds,
    tabId,
  });
}

describe("browser tab owners", () => {
  it("counts the most recently claimed tab as the caller's newest", () => {
    let owners = claim(EMPTY_BROWSER_TAB_OWNERS, "a", GRANT, ["a", "b"]);
    owners = claim(owners, "b", GRANT, ["a", "b"]);

    expect(
      newestBrowserTabOwnedBy({
        issuer: GRANT,
        openTabIds: ["a", "b"],
        owners,
      }),
    ).toBe("b");
  });

  it("re-claiming a tab moves it to the front of the queue", () => {
    let owners = claim(EMPTY_BROWSER_TAB_OWNERS, "a", GRANT, ["a", "b"]);
    owners = claim(owners, "b", GRANT, ["a", "b"]);
    // A handover of a tab the caller already had, or a second open of the same
    // tab: `Map.set` alone would leave it where it was, and "my newest" would
    // then name a tab the caller stopped working in.
    owners = claim(owners, "a", GRANT, ["a", "b"]);

    expect(
      newestBrowserTabOwnedBy({
        issuer: GRANT,
        openTabIds: ["a", "b"],
        owners,
      }),
    ).toBe("a");
  });

  it("skips a tab that is no longer open", () => {
    const owners = claim(EMPTY_BROWSER_TAB_OWNERS, "a", GRANT, ["a"]);

    expect(
      newestBrowserTabOwnedBy({ issuer: GRANT, openTabIds: [], owners }),
    ).toBeNull();
  });

  it("drops every claim whose tab is gone, not only the one being written", () => {
    let owners = claim(EMPTY_BROWSER_TAB_OWNERS, "a", GRANT, ["a", "b", "c"]);
    owners = claim(owners, "b", GRANT, ["a", "b", "c"]);
    // The person closed "a" and "b" from the strip, which nothing tells this
    // module about. The next write is the only chance to notice.
    owners = claim(owners, "c", GRANT, ["c"]);

    expect([...owners.keys()]).toEqual(["c"]);
  });

  it("hands a tab back to the person with a null issuer", () => {
    let owners = claim(EMPTY_BROWSER_TAB_OWNERS, "a", GRANT, ["a"]);
    owners = claim(owners, "a", null, ["a"]);

    expect(owners.has("a")).toBe(false);
  });

  it("knows a renamed grant is the same agent", () => {
    const owners = claim(EMPTY_BROWSER_TAB_OWNERS, "a", GRANT, ["a"]);

    // The label is a person's note to themselves; the id is the credential.
    expect(
      browserTabOwnerFor({ claim: owners.get("a"), issuer: RENAMED }),
    ).toBe("you");
  });

  it("lets a turn use the person's tab and nobody use another agent's", () => {
    const theirs = undefined;
    const mine = { issuer: GRANT, mode: "drive" } as const;
    const somebody = { issuer: OTHER, mode: "drive" } as const;

    expect(act({ claim: theirs, issuer: TURN })).toBe(true);
    expect(act({ claim: theirs, issuer: GRANT })).toBe(false);
    expect(act({ claim: mine, issuer: TURN })).toBe(false);
    expect(act({ claim: mine, issuer: GRANT })).toBe(true);
    expect(act({ claim: somebody, issuer: GRANT })).toBe(false);
  });

  it("lends a look without lending the tab", () => {
    const lent = { issuer: GRANT, mode: "look" } as const;

    // To its holder the tab is `shared`: readable, and nothing more.
    expect(browserTabOwnerFor({ claim: lent, issuer: GRANT })).toBe("shared");
    expect(
      mayActOnBrowserTab({ claim: lent, issuer: GRANT, need: "page.read" }),
    ).toBe(true);
    expect(
      mayActOnBrowserTab({
        claim: lent,
        issuer: GRANT,
        need: "network.observe",
      }),
    ).toBe(true);
    for (const need of [
      "tabs.modify",
      "page.interact",
      "page.credentials",
      "page.inject",
      "network.intercept",
      "page.record",
    ] as const) {
      expect(mayActOnBrowserTab({ claim: lent, issuer: GRANT, need })).toBe(
        false,
      );
    }

    // And to everybody else it is still the person's, which is the half that
    // matters most: lending a page to one agent must not take it away from the
    // thread the person is discussing it in.
    expect(browserTabOwnerFor({ claim: lent, issuer: TURN })).toBe("person");
    expect(act({ claim: lent, issuer: TURN })).toBe(true);
    expect(act({ claim: lent, issuer: OTHER })).toBe(false);
  });

  it("never makes a lent tab the caller's default target", () => {
    let owners = claim(EMPTY_BROWSER_TAB_OWNERS, "a", GRANT, ["a", "b"]);
    // Lent second, so it is the newest entry in the map.
    owners = claim(owners, "b", GRANT, ["a", "b"], "look");

    expect(
      newestBrowserTabOwnedBy({
        issuer: GRANT,
        openTabIds: ["a", "b"],
        owners,
      }),
    ).toBe("a");
  });

  it("survives a reload, and shrugs off a stored value it cannot read", () => {
    const owners = claim(EMPTY_BROWSER_TAB_OWNERS, "a", GRANT, ["a"]);

    expect(
      parseBrowserTabOwners(
        JSON.stringify([...owners]),
        EMPTY_BROWSER_TAB_OWNERS,
      ).get("a"),
    ).toEqual({ issuer: GRANT, mode: "drive" });
    // A claim stored before there were modes is one somebody drove, which is
    // what it meant. Reading it any other way would hand every agent's tab back
    // to the person on the upgrade and then refuse the agent its own next
    // command.
    expect(
      parseBrowserTabOwners(
        JSON.stringify([["a", GRANT]]),
        EMPTY_BROWSER_TAB_OWNERS,
      ).get("a"),
    ).toEqual({ issuer: GRANT, mode: "drive" });
    // Junk in storage means "nobody owns anything", never a crash on start:
    // the browser surface is what would fail to mount.
    expect(
      parseBrowserTabOwners('{"a":"nonsense"}', EMPTY_BROWSER_TAB_OWNERS).size,
    ).toBe(0);
    expect(
      parseBrowserTabOwners("not json at all", EMPTY_BROWSER_TAB_OWNERS).size,
    ).toBe(0);
  });
});

describe("the handover ask", () => {
  function storeWithTabs(ids: readonly string[]) {
    const store = createStore();
    store.set(browserSurfaceTabsAtom, {
      activeTabId: ids[0] ?? null,
      tabs: ids.map((id) => ({
        ...createBrowserFixedPanelTab({ environmentId: null, url: "" }),
        id,
      })),
    });
    return store;
  }

  it("keeps the ask that is waiting rather than swapping it", () => {
    // The attack it is against: an agent names a harmless tab, the person moves
    // to press "Hand it over", and the agent names the tab it actually wants
    // before the click lands. It can ask once per command, so the row would
    // change as often as it liked.
    const store = storeWithTabs(["a", "b"]);
    store.set(requestBrowserTabHandoverAtom, { issuer: GRANT, tabId: "a" });
    store.set(requestBrowserTabHandoverAtom, { issuer: GRANT, tabId: "b" });

    expect(store.get(browserTabHandoverAskAtom)).toEqual({
      issuer: GRANT,
      tabId: "a",
    });
  });

  it("asks again once the person has answered the last one", () => {
    const store = storeWithTabs(["a", "b"]);
    store.set(requestBrowserTabHandoverAtom, { issuer: GRANT, tabId: "a" });
    store.set(browserTabHandoverAskAtom, null);
    store.set(requestBrowserTabHandoverAtom, { issuer: GRANT, tabId: "b" });

    expect(store.get(browserTabHandoverAskAtom)).toEqual({
      issuer: GRANT,
      tabId: "b",
    });
  });

  it("does not wedge on an ask whose tab has been closed", () => {
    // The row draws nothing for a tab that is gone, so a waiting ask nobody can
    // answer would have blocked every later one — handover gone from that
    // window until a reload.
    const store = storeWithTabs(["a"]);
    store.set(requestBrowserTabHandoverAtom, { issuer: GRANT, tabId: "a" });
    store.set(browserSurfaceTabsAtom, { activeTabId: null, tabs: [] });
    store.set(requestBrowserTabHandoverAtom, { issuer: GRANT, tabId: "b" });

    expect(store.get(browserTabHandoverAskAtom)).toEqual({
      issuer: GRANT,
      tabId: "b",
    });
  });
});
