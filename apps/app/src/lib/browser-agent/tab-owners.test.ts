import { createStore } from "jotai";
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
const TURN: BrowserCommandIssuer = { kind: "thread", threadId: "thread_1" };

function claim(
  owners: BrowserTabOwners,
  tabId: string,
  issuer: BrowserCommandIssuer | null,
  openTabIds: readonly string[],
): BrowserTabOwners {
  return withBrowserTabOwner(owners, { issuer, openTabIds, tabId });
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
      browserTabOwnerFor({ issuer: RENAMED, owner: owners.get("a") }),
    ).toBe("you");
  });

  it("lets a turn use the person's tab and nobody use another agent's", () => {
    expect(mayActOnBrowserTab({ issuer: TURN, owner: "person" })).toBe(true);
    expect(mayActOnBrowserTab({ issuer: GRANT, owner: "person" })).toBe(false);
    expect(mayActOnBrowserTab({ issuer: TURN, owner: "agent" })).toBe(false);
    expect(mayActOnBrowserTab({ issuer: GRANT, owner: "you" })).toBe(true);
  });

  it("survives a reload, and shrugs off a stored value it cannot read", () => {
    const owners = claim(EMPTY_BROWSER_TAB_OWNERS, "a", GRANT, ["a"]);

    expect(
      parseBrowserTabOwners(
        JSON.stringify([...owners]),
        EMPTY_BROWSER_TAB_OWNERS,
      ).get("a"),
    ).toEqual(GRANT);
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
  it("keeps the ask that is waiting rather than swapping it", () => {
    // The attack it is against: an agent names a harmless tab, the person moves
    // to press "Hand it over", and the agent names the tab it actually wants
    // before the click lands. It can ask once per command, so the row would
    // change as often as it liked.
    const store = createStore();
    store.set(requestBrowserTabHandoverAtom, { issuer: GRANT, tabId: "a" });
    store.set(requestBrowserTabHandoverAtom, { issuer: GRANT, tabId: "b" });

    expect(store.get(browserTabHandoverAskAtom)).toEqual({
      issuer: GRANT,
      tabId: "a",
    });
  });

  it("asks again once the person has answered the last one", () => {
    const store = createStore();
    store.set(requestBrowserTabHandoverAtom, { issuer: GRANT, tabId: "a" });
    store.set(browserTabHandoverAskAtom, null);
    store.set(requestBrowserTabHandoverAtom, { issuer: GRANT, tabId: "b" });

    expect(store.get(browserTabHandoverAskAtom)).toEqual({
      issuer: GRANT,
      tabId: "b",
    });
  });
});
