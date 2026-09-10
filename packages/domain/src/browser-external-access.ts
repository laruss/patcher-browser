import { z } from "zod";
import {
  BROWSER_COMMAND_PERMISSIONS,
  type BrowserCommandPermission,
} from "./plugin-permissions.js";

/**
 * How far an agent running *outside* Patcher may drive the browser.
 *
 * The question this answers is not the one the plugin toggle answers. Enabling
 * `browser-tools` says the browser may be driven by an agent at all; this says
 * whether a caller that is not one of Patcher's own turns may be that agent,
 * and how far. They are different questions because the callers are different
 * people: a turn is something the user started inside Patcher and can watch in
 * a thread, while `patcher browser` run from a terminal is Claude Code, Codex,
 * a script, or the user — and until this existed the server treated all of them
 * as the app and asked nobody.
 *
 * **A level, not a switch, because the browser holds logins.** "May an agent
 * read the page I am looking at" and "may an agent read my cookies for it" are
 * not the same permission, and one flag covering both would say neither — the
 * same argument `patcher.sites` makes about *where* a plugin reaches, applied
 * to *how far*.
 *
 * **Which caller, exactly.** This level is charged to an outside caller holding
 * the *app key* — the master credential, a 0600 file any process running as the
 * user can read — so it is not a boundary against that caller: it can write this
 * setting as easily as read it, which is the position `docs/security.md` states
 * about every local gate. What it buys is that the browser is closed by default
 * and opening it is the user's act.
 *
 * The boundary is the other credential. A **browser access grant** carries its
 * own level, reaches two routes, and cannot write this setting or mint another
 * grant — see `agent-access-key.ts` in @patcher/config. It is deliberately *not*
 * bounded by this level, and the reverse of a ceiling is the point: making the
 * setting a ceiling would mean opening the browser to every process on the
 * machine before you could open it to one named agent. The shape this is built
 * for is the setting left `off` and one grant issued to the agent that needs it.
 *
 * **And it covers every plugin's CLI, not only `patcher browser`.** The level is
 * charged on commands issued on the caller's own async stack — every built-in
 * plugin — and on an installed plugin's, which runs in its own process and gets
 * the caller back off the channel frame (`browser-caller-handoff.ts` in the
 * server). So a third-party plugin with browser permissions and a CLI command of
 * its own is not a second door round this.
 *
 * What the level is not charged on is a plugin's *own* work — a schedule, a
 * background service, an HTTP route the app called — because none of those is a
 * caller from outside Patcher. Those are charged the permissions the plugin
 * declared, which is what installing it agreed to.
 */
export const BROWSER_EXTERNAL_ACCESS_LEVELS = [
  "off",
  "read",
  "interact",
  "full",
] as const;

export const browserExternalAccessLevelSchema = z.enum(
  BROWSER_EXTERNAL_ACCESS_LEVELS,
);

export type BrowserExternalAccessLevel = z.infer<
  typeof browserExternalAccessLevelSchema
>;

/**
 * The level a *grant* carries, which is the same ramp without `off`.
 *
 * A grant is a credential somebody issued on purpose; one that admits nothing
 * is not a narrower grant, it is a row that should not exist. Revoking is how a
 * grant stops working, and revoking says so — a date, in a list — where a grant
 * quietly set to `off` would read as working.
 *
 * Derived from the four rather than written out again, so a level added to the
 * ramp lands here too instead of silently staying out of grants.
 */
export const browserAccessGrantLevelSchema =
  browserExternalAccessLevelSchema.exclude(["off"]);
export type BrowserAccessGrantLevel = z.infer<
  typeof browserAccessGrantLevelSchema
>;
export const BROWSER_ACCESS_GRANT_LEVELS =
  browserAccessGrantLevelSchema.options;

/**
 * The lowest level that admits each browser command permission.
 *
 * A `Record` over {@link BROWSER_COMMAND_PERMISSIONS} rather than three lists,
 * so a browser permission added later does not compile until somebody decides
 * what it costs an outside agent — the same property
 * `permissionForBrowserCommand` has one layer down, for the same reason.
 *
 * The three groups, and what separates them:
 *
 * - **read** — what the page shows and where the tabs point. A page's text,
 *   its accessibility tree, a screenshot, its console and its network log.
 *   Everything here is already on the user's own screen, and nothing here
 *   changes anything — with one deliberate exception, `tabs.release`, which
 *   changes only the caller's own access and only downwards. It is filed here
 *   because a caller lent a tab at this level must be able to give it back
 *   (#117), and `permissionForBrowserCommand` says the same thing beside the
 *   price itself.
 * - **interact** — driving the browser as the user would: opening and closing
 *   tabs, navigating, clicking, typing, answering a page's dialogs. This is the
 *   level at which an agent can act *as* the signed-in user on a site, which is
 *   why it is a step of its own rather than folded into reading.
 * - **full** — the three that hand over more than a user's own hands do.
 *   `page.credentials` is the session cookies themselves, which is a login that
 *   can be carried off the machine rather than used in place. `page.inject` is
 *   arbitrary JavaScript in a page holding those cookies. `network.intercept`
 *   decides what the page is told it received. `page.record` films the tabs,
 *   which is every page the user has open while it runs.
 */
const LOWEST_LEVEL_FOR_PERMISSION: Record<
  BrowserCommandPermission,
  Exclude<BrowserExternalAccessLevel, "off">
> = {
  "tabs.read": "read",
  "page.read": "read",
  "network.observe": "read",
  "tabs.modify": "interact",
  "page.interact": "interact",
  "page.credentials": "full",
  "page.inject": "full",
  "network.intercept": "full",
  "page.record": "full",
};

/** Where each level sits, so "at least this far" is a comparison. */
const LEVEL_RANK: Record<BrowserExternalAccessLevel, number> =
  Object.fromEntries(
    BROWSER_EXTERNAL_ACCESS_LEVELS.map((level, index) => [level, index]),
  ) as Record<BrowserExternalAccessLevel, number>;

/** Whether `level` admits a command costing `permission`. */
export function browserExternalAccessAllows(
  level: BrowserExternalAccessLevel,
  permission: BrowserCommandPermission,
): boolean {
  return (
    LEVEL_RANK[level] >= LEVEL_RANK[LOWEST_LEVEL_FOR_PERMISSION[permission]]
  );
}

/**
 * Everything `level` admits, in the order {@link BROWSER_COMMAND_PERMISSIONS}
 * declares — which is reading, then acting, then the rest, so a list rendered
 * from it reads as a ramp rather than as an alphabetised jumble.
 */
export function permissionsForBrowserExternalAccess(
  level: BrowserExternalAccessLevel,
): readonly BrowserCommandPermission[] {
  return BROWSER_COMMAND_PERMISSIONS.filter((permission) =>
    browserExternalAccessAllows(level, permission),
  );
}

/** The lowest level that would admit `permission`, for a refusal to name. */
export function lowestBrowserExternalAccessLevelFor(
  permission: BrowserCommandPermission,
): BrowserExternalAccessLevel {
  return LOWEST_LEVEL_FOR_PERMISSION[permission];
}

/**
 * One line per level, for a settings control and for a consent prompt.
 *
 * Written for the person deciding rather than for the code: they are choosing
 * what someone else's agent may do to the browser they are signed in to, and
 * "page.credentials" is not a sentence anybody can answer.
 */
export const BROWSER_EXTERNAL_ACCESS_DESCRIPTIONS: Record<
  BrowserExternalAccessLevel,
  { label: string; detail: string }
> = {
  off: {
    label: "Off",
    detail:
      "`patcher browser` refuses agents and terminals outside Patcher that hold no grant, including one reaching the browser through a plugin's own command. Three things are unaffected: a browser access grant you issued, which carries its own level; Patcher's own threads; and the work a plugin does by itself, which is charged the permissions it declared.",
  },
  read: {
    label: "Read pages",
    detail:
      "Read your open tabs, the text and structure of a page, screenshots, and what a page logs and requests. The only thing it can change is its own access: an agent you have lent a tab can hand that tab back.",
  },
  interact: {
    label: "Read and act",
    detail:
      "Everything above, plus opening and closing tabs, navigating, clicking and typing — acting on sites as you, while you are signed in to them.",
  },
  full: {
    label: "Everything, including logins",
    detail:
      "Everything above, plus your cookies and site storage for a tab, running its own JavaScript in a page, changing what a page receives from the network, and filming tabs.",
  },
};
