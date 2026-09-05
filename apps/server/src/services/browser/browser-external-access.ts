import { AsyncLocalStorage } from "node:async_hooks";
import {
  browserExternalAccessAllows,
  lowestBrowserExternalAccessLevelFor,
  type BrowserCommand,
  type BrowserExternalAccessLevel,
} from "@patcher/domain";
import { permissionForBrowserCommand } from "@patcher/domain/plugin-permissions";

/**
 * Charging a browser command to the caller when the caller is not one of ours.
 *
 * `patcher browser` executes in this process, as a plugin CLI command, and
 * until this existed the server could not tell whose it was: a turn's shell, a
 * person's terminal and Claude Code all arrive on the same loopback route with
 * the same credential. The thread credential settled that for turns — a request
 * carrying one is an agent inside Patcher, and the plugin toggle plus its
 * consent prompt is that agent's gate. Everything else is *outside* Patcher,
 * and had no gate at all.
 *
 * **Why an ambient scope rather than an argument.** The decision has to be made
 * per browser command, because the levels differ per command; the place that
 * knows the caller is the route, forty call sites away from the place that
 * knows the command. Threading a parameter through `patcher.browser`'s whole
 * surface would put the gate in the plugin SDK, where a plugin could decline to
 * pass it. An `AsyncLocalStorage` keeps the decision on the host's side of the
 * boundary and out of the contract — the same shape `telemetry.ts` and
 * `process-local-queued-lock.ts` already use here.
 *
 * **What it covers, exactly.** Commands issued on the caller's own async stack.
 * That is every built-in plugin, which is the whole of what `patcher browser`
 * reaches. It is *not* an installed plugin running in its own process: the
 * host charges those on a channel message, in a fresh async context, so the
 * scope does not reach them and they are charged what they declared, as before.
 * Nothing hides behind that gap — an external caller holding the app key can
 * install a plugin, and could equally rewrite this setting — and closing it is
 * the business of the narrower credential this deliberately does not build. See
 * `browser-external-access.ts` in `@patcher/domain` for that argument in full.
 */

export interface BrowserExternalCallerScope {
  /** How far this install lets an agent outside Patcher go. */
  level: BrowserExternalAccessLevel;
  /**
   * The command line the caller ran, for the refusal to quote back. `patcher
   * browser` for the plugin whose CLI this is, so the sentence names something
   * the reader typed rather than a route.
   */
  invocation: string;
}

const scopeStorage = new AsyncLocalStorage<BrowserExternalCallerScope>();

/**
 * Run `fn` as a caller from outside Patcher.
 *
 * Only wrap the work of a request that really is one. A scope left over a
 * turn's call, or over the app's own, would refuse something the user is
 * looking at — which is why the one route that establishes this checks the
 * *verified* thread identity rather than the header beside it.
 */
export function runAsExternalBrowserCaller<T>(
  scope: BrowserExternalCallerScope,
  fn: () => T,
): T {
  return scopeStorage.run(scope, fn);
}

/** The scope this call is running under, if any. Exported for tests. */
export function currentExternalBrowserCaller():
  | BrowserExternalCallerScope
  | undefined {
  return scopeStorage.getStore();
}

/**
 * Why this command is refused, or null when it is allowed.
 *
 * Null for every caller that is not external, which is the common case and the
 * one that must stay free: the app driving its own browser, a plugin
 * contribution, and a turn's agent tools all run with no scope.
 *
 * The message is written for whoever reads it — most often a model that will
 * otherwise retry the same call — so it says what was refused, what this
 * install currently allows, and the two ways a person changes it. It ends by
 * saying nothing happened, because a refusal that leaves the reader unsure
 * whether the click landed is worse than no refusal at all.
 */
export function browserExternalAccessRefusal(
  command: BrowserCommand,
): string | null {
  const scope = scopeStorage.getStore();
  if (scope === undefined) return null;
  const permission = permissionForBrowserCommand(command);
  if (browserExternalAccessAllows(scope.level, permission)) return null;
  const needed = lowestBrowserExternalAccessLevelFor(permission);
  const current =
    scope.level === "off"
      ? "this install does not let agents outside Patcher drive the browser at all"
      : `this install allows them "${scope.level}"`;
  return (
    `${scope.invocation} ran a browser command needing "${permission}", and ${current}. ` +
    `Nothing happened. The person at this machine can allow it in Patcher's ` +
    `Settings → Browser, or by running \`patcher settings browser-access ${needed}\` ` +
    `in their own terminal. Ask them rather than retrying: this is a decision, not a transient failure.`
  );
}
