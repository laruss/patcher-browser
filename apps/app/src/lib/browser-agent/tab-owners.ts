import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { z } from "zod";
import {
  browserCommandIssuerSchema,
  type BrowserCommandIssuer,
} from "@patcher/server-contract";
import type { BrowserTabOwner } from "@patcher/domain";
import { createLocalStorageSyncStorage } from "../browser-storage";
import {
  browserSurfaceTabsAtom,
  getBrowserSurfaceWebTabs,
} from "../browser-surface-tabs";
import { getDesktopWindowKey } from "../patcher-desktop";
import { browserIssuerKey } from "./issuer";

/**
 * Which tabs belong to which caller, and what that lets a caller do.
 *
 * The problem this answers: every tab-targeting command takes a `tabId` that
 * may be null, null has always meant "the active tab", and the active tab is
 * the one the person is looking at. Two agents working at once therefore land
 * on the same tab as each other and as the human — one opens a page while the
 * other is reading it, and both were doing the documented thing.
 *
 * So a tab has an owner. A tab an agent opened is that agent's; a tab the
 * person opened is theirs, and the strip is full of those. The rule the owner
 * decides, in {@link mayActOnBrowserTab}, is deliberately not symmetric:
 *
 * - **A turn inside Patcher may use the person's tab.** They are in the same
 *   window having a conversation about it, and "read the page I am looking at"
 *   is the case the whole in-app tool surface was built for. It cannot touch
 *   another *agent's* tab, which is the collision this exists to stop.
 * - **A caller outside Patcher may not**, until the person hands it over. It
 *   has no thread to be visible in, and nothing on screen said it was coming.
 *
 * Ownership binds agents, never the person: everything reachable from the strip
 * — clicking, typing, closing — is theirs regardless of who opened the tab.
 *
 * **Persisted with the tabs.** The strip survives a reload and a restart, so a
 * record of who owns what has to as well, or a Cmd+R would quietly return every
 * agent's tab to the person and refuse the agent its own next command.
 */

/**
 * Per window, like the tabs themselves.
 *
 * Each window keeps its own strip (`getBrowserSurfaceTabsStorageKey`), so a
 * shared owners map would be a map about tabs most of its readers do not have —
 * and every write prunes claims whose tabs are not open *here*, which would
 * quietly hand one window's agent tabs back to the person the moment another
 * window recorded a claim.
 */
export function browserTabOwnersStorageKey(): string {
  const windowKey = getDesktopWindowKey();
  const base = "patcher.browserSurface.tabOwners-1";
  return windowKey === null ? base : `${base}-${windowKey}`;
}

/** Tab id → the caller it belongs to. Insertion order is oldest-tab-first. */
export type BrowserTabOwners = ReadonlyMap<string, BrowserCommandIssuer>;

export const EMPTY_BROWSER_TAB_OWNERS: BrowserTabOwners = new Map();

const browserTabOwnersSchema = z.array(
  z.tuple([z.string().min(1), browserCommandIssuerSchema]),
);

export function parseBrowserTabOwners(
  storedValue: string | null,
  initialValue: BrowserTabOwners,
): BrowserTabOwners {
  if (storedValue === null) {
    return initialValue;
  }
  try {
    const parsed = browserTabOwnersSchema.safeParse(JSON.parse(storedValue));
    return parsed.success ? new Map(parsed.data) : initialValue;
  } catch {
    return initialValue;
  }
}

const browserTabOwnersStorage = createLocalStorageSyncStorage<BrowserTabOwners>(
  {
    parse: parseBrowserTabOwners,
    serialize: (value) => JSON.stringify([...value]),
  },
);

export const browserTabOwnersAtom = atomWithStorage<BrowserTabOwners>(
  browserTabOwnersStorageKey(),
  EMPTY_BROWSER_TAB_OWNERS,
  browserTabOwnersStorage,
  { getOnInit: true },
);

/**
 * Records an owner, or hands a tab back to the person with a null issuer.
 *
 * Also where a closed tab's entry goes: `openTabIds` is the strip as it is now,
 * and anything else is dropped. Doing it on every write rather than on close
 * means one place knows the rule, instead of the agent's close path and the
 * user's close path each having to remember.
 *
 * The entry is deleted before it is set so the map stays in order of *when the
 * tab was claimed* — `Map.set` on an existing key keeps its old position, and
 * that order is what {@link newestBrowserTabOwnedBy} reads.
 */
export function withBrowserTabOwner(
  owners: BrowserTabOwners,
  {
    issuer,
    openTabIds,
    tabId,
  }: {
    issuer: BrowserCommandIssuer | null;
    openTabIds: readonly string[];
    tabId: string;
  },
): BrowserTabOwners {
  const open = new Set(openTabIds);
  const next = new Map(
    [...owners].filter(([id]) => id !== tabId && open.has(id)),
  );
  if (issuer !== null && open.has(tabId)) {
    next.set(tabId, issuer);
  }
  return next;
}

/**
 * The caller's own newest open tab, which is what a null `tabId` means to it.
 *
 * Newest rather than "the one it used last": the map moves an entry to the end
 * when the tab is claimed, and nothing rewrites it per command, so this is the
 * tab the caller most recently opened or was handed. That is a rule an agent
 * can hold in its head — the alternative, "whichever you touched last", makes
 * the target of an unqualified command depend on history it cannot see.
 */
export function newestBrowserTabOwnedBy({
  issuer,
  openTabIds,
  owners,
}: {
  issuer: BrowserCommandIssuer;
  openTabIds: readonly string[];
  owners: BrowserTabOwners;
}): string | null {
  const key = browserIssuerKey(issuer);
  const open = new Set(openTabIds);
  for (const [tabId, owner] of [...owners].reverse()) {
    if (open.has(tabId) && browserIssuerKey(owner) === key) {
      return tabId;
    }
  }
  return null;
}

/** Whose a tab is, said the way the caller being answered would say it. */
export function browserTabOwnerFor({
  issuer,
  owner,
}: {
  issuer: BrowserCommandIssuer;
  owner: BrowserCommandIssuer | undefined;
}): BrowserTabOwner {
  if (owner === undefined) return "person";
  return browserIssuerKey(owner) === browserIssuerKey(issuer) ? "you" : "agent";
}

/**
 * The rule itself. See the module docstring for why a turn is let through and a
 * caller outside Patcher is not.
 */
export function mayActOnBrowserTab({
  issuer,
  owner,
}: {
  issuer: BrowserCommandIssuer;
  owner: BrowserTabOwner;
}): boolean {
  switch (owner) {
    case "you":
      return true;
    case "person":
      return issuer.kind === "thread";
    case "agent":
      return false;
  }
}

/**
 * A caller outside Patcher asked for the person's tab and was refused.
 *
 * Kept so the browser window can offer the person the one-click answer, because
 * the refusal alone leaves them with an agent saying "ask them to hand it over"
 * and nothing to press.
 *
 * Not persisted. A window that reloaded is no longer showing the moment the ask
 * belonged to, and the agent — which is still refused — will ask again.
 */
export interface BrowserTabHandoverAsk {
  tabId: string;
  issuer: BrowserCommandIssuer;
}

export const browserTabHandoverAskAtom = atom<BrowserTabHandoverAsk | null>(
  null,
);

/**
 * Raises an ask, unless one the person can still answer is waiting.
 *
 * **A waiting ask is not replaced**, and that is a rule about a click rather
 * than about freshness. An agent chooses which tab it names and can name a new
 * one per command, so a row that swapped under the pointer would let it show a
 * harmless page, wait for the person to commit to pressing, and swap in the tab
 * it actually wants. Whoever asked first stays until the person answers or
 * dismisses it; the agent's own refusal already tells it to ask them again.
 *
 * **Unless its tab is gone**, which is the other half of the same rule and was
 * missed the first time: the row draws nothing for a closed tab, so a waiting
 * ask nobody can answer would have wedged every later one out of the window
 * until a reload. Both halves found by review on 2026-09-05.
 */
export const requestBrowserTabHandoverAtom = atom(
  null,
  (get, set, ask: BrowserTabHandoverAsk) => {
    const waiting = get(browserTabHandoverAskAtom);
    const answerable =
      waiting !== null &&
      getBrowserSurfaceWebTabs(get(browserSurfaceTabsAtom)).some(
        (tab) => tab.id === waiting.tabId,
      );
    if (answerable) return;
    set(browserTabHandoverAskAtom, ask);
  },
);
