import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { z } from "zod";
import {
  browserCommandIssuerSchema,
  type BrowserCommandIssuer,
} from "@patcher/server-contract";
import {
  BROWSER_COMMAND_PERMISSIONS,
  type BrowserCommandPermission,
  type BrowserTabOwner,
} from "@patcher/domain";
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
 * The person has two ways to say yes, and a claim records which (#117). **Drive**
 * is the old one: the tab becomes that caller's, at whatever its grant allows.
 * **Look** lends the page without lending the browsing — reads answer, acting
 * does not — and it leaves the tab *the person's* to everybody, this rule
 * included, because a view onto a page is not a transfer of it. Making a look
 * claim read as ownership would have taken the person's own page away from the
 * thread they were discussing it in.
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

/**
 * What a caller was given on a tab: the whole of it, or the sight of it.
 *
 * One relation with a mode rather than two relations side by side. Everything
 * that keys on a tab having a claim — the strip's mark, the tab menu's offer to
 * end it, the prune when a tab closes, the per-window persistence — then covers
 * a look claim without being told about it. A second, quieter relation would
 * have had none of those, and would have produced a long-lived reader on a tab
 * nobody could see was being read.
 */
export type BrowserTabClaimMode = "look" | "drive";

export interface BrowserTabClaim {
  issuer: BrowserCommandIssuer;
  mode: BrowserTabClaimMode;
}

/** Tab id → the claim on it. Insertion order is oldest-tab-first. */
export type BrowserTabOwners = ReadonlyMap<string, BrowserTabClaim>;

export const EMPTY_BROWSER_TAB_OWNERS: BrowserTabOwners = new Map();

const browserTabClaimSchema = z.object({
  issuer: browserCommandIssuerSchema,
  mode: z.enum(["look", "drive"]),
});

/**
 * Both shapes, because the stored ones predate the mode.
 *
 * A claim written before #117 is a bare issuer, and it meant what `drive` means
 * now, so it is read as one. The alternative — a new storage key — would hand
 * every agent's tab back to the person on the upgrade and then refuse the agent
 * its own next command, which is the exact failure the module docstring says
 * persistence exists to prevent.
 *
 * The two shapes cannot be confused: an issuer is a union discriminated on
 * `kind`, and a claim has no `kind` of its own.
 *
 * **What this trades is the downgrade.** `safeParse` runs over the whole array,
 * so an older build reading a map this one wrote drops *every* claim in that
 * window rather than the new-shaped ones — the same failure, pointed the other
 * way. Worth it while the shape is one release old and the upgrade is the
 * direction people travel.
 */
const browserTabOwnersSchema = z.array(
  z.tuple([
    z.string().min(1),
    z.union([
      browserTabClaimSchema,
      browserCommandIssuerSchema.transform(
        (issuer): BrowserTabClaim => ({ issuer, mode: "drive" }),
      ),
    ]),
  ]),
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
 * Records a claim, or hands a tab back to the person with a null one.
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
    claim,
    openTabIds,
    tabId,
  }: {
    claim: BrowserTabClaim | null;
    openTabIds: readonly string[];
    tabId: string;
  },
): BrowserTabOwners {
  const open = new Set(openTabIds);
  const next = new Map(
    [...owners].filter(([id]) => id !== tabId && open.has(id)),
  );
  if (claim !== null && open.has(tabId)) {
    next.set(tabId, claim);
  }
  return next;
}

/** Whether this claim is this caller's own. */
function heldBy(
  claim: BrowserTabClaim | undefined,
  issuer: BrowserCommandIssuer,
): boolean {
  return (
    claim !== undefined &&
    browserIssuerKey(claim.issuer) === browserIssuerKey(issuer)
  );
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
  const open = new Set(openTabIds);
  for (const [tabId, claim] of [...owners].reverse()) {
    // A look claim is never what a null tabId means, however new it is. The
    // person lent a page to be read, not a default target — "let them look at
    // this" must not silently redirect every unqualified command of theirs into
    // the tab the person is working in (#117).
    if (open.has(tabId) && claim.mode === "drive" && heldBy(claim, issuer)) {
      return tabId;
    }
  }
  return null;
}

/** Whether the person has lent this caller a look at some open tab. */
export function browserTabLentToLookAt({
  issuer,
  openTabIds,
  owners,
}: {
  issuer: BrowserCommandIssuer;
  openTabIds: readonly string[];
  owners: BrowserTabOwners;
}): string | null {
  const open = new Set(openTabIds);
  for (const [tabId, claim] of [...owners].reverse()) {
    if (open.has(tabId) && claim.mode === "look" && heldBy(claim, issuer)) {
      return tabId;
    }
  }
  return null;
}

/**
 * Whose a tab is, said the way the caller being answered would say it.
 *
 * A **look** claim answers `"person"` to everyone but its holder, and `"shared"`
 * to the holder. Both halves matter. The tab really is still the person's — they
 * are working in it, and the claim lent a view of the page rather than the page
 * — so any other caller entitled to their tabs must go on being entitled to this
 * one; answering `"agent"` there would refuse the person's own in-app thread the
 * page it is discussing with them, and offer them "Take back" on a tab nobody
 * took. And the holder needs the fourth word rather than `"person"`, because
 * `"person"` would tell it not to bother reading a page it has just been lent.
 */
export function browserTabOwnerFor({
  claim,
  issuer,
}: {
  claim: BrowserTabClaim | undefined;
  issuer: BrowserCommandIssuer;
}): BrowserTabOwner {
  if (claim === undefined) return "person";
  if (claim.mode === "look") return heldBy(claim, issuer) ? "shared" : "person";
  return heldBy(claim, issuer) ? "you" : "agent";
}

/**
 * What a look claim admits: reading the page, and nothing that changes it.
 *
 * A `Record` over {@link BROWSER_COMMAND_PERMISSIONS} rather than a list, so a
 * browser permission added later does not compile until somebody decides
 * whether "look, don't touch" covers it — the property
 * `permissionForBrowserCommand` and `LOWEST_LEVEL_FOR_PERMISSION` both have, for
 * the same reason.
 *
 * It is the same line the `read` external-access level draws, and it is written
 * out again on purpose rather than derived from it. The two answer different
 * questions: that one is how far an outside caller may reach into this browser
 * *at all*, set once in settings or minted into a grant, while this one is what
 * the person said about *this tab* when they were asked. They agree today; a
 * change to either should be argued on its own terms rather than arriving as a
 * side effect of the other.
 *
 * What "look" costs the person, which the docs say and this cannot: reading a
 * page's structure attaches the browser's debugger, and from then on that tab's
 * JavaScript dialogs are drawn by Patcher instead of by Chromium
 * (`BrowserPageDialog.tsx`). They still answer them; the box looks different.
 * That is the same cost a turn already puts on a tab it reads for them.
 */
const LOOK_CLAIM_ADMITS: Record<BrowserCommandPermission, boolean> = {
  "tabs.read": true,
  "page.read": true,
  "network.observe": true,
  "tabs.modify": false,
  "page.interact": false,
  "page.credentials": false,
  "page.inject": false,
  "network.intercept": false,
  "page.record": false,
};

/**
 * The rule itself. See the module docstring for why a turn is let through and a
 * caller outside Patcher is not.
 *
 * `need` is what the command costs (`permissionForBrowserCommand`), which is
 * what a lent tab is measured against rather than a second judgement written
 * beside each command.
 *
 * This is the whole rule for a tab a caller *named*, and it is the whole rule
 * for whether a caller may fall back to the tab in front of the person — but
 * the two do not ask it about the same commands. See `resolveTab`, which lets
 * `tabs.read` past for a named tab and never for the fallback.
 */
export function mayActOnBrowserTab({
  claim,
  issuer,
  need,
}: {
  claim: BrowserTabClaim | undefined;
  issuer: BrowserCommandIssuer;
  need: BrowserCommandPermission;
}): boolean {
  switch (browserTabOwnerFor({ claim, issuer })) {
    case "you":
      return true;
    case "person":
      return issuer.kind === "thread";
    case "shared":
      return LOOK_CLAIM_ADMITS[need];
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
