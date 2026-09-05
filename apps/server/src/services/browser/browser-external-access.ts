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
 * install a plugin, and could equally rewrite the install-wide setting. See
 * `browser-external-access.ts` in `@patcher/domain` for that argument in full.
 *
 * **Two callers now, and two levels.** The setting is what an outside caller
 * holding the *app key* is allowed, and that caller can write it, so it is a
 * default rather than a boundary. A caller holding a **browser access grant**
 * is charged that grant's own level instead: a credential that reaches two
 * routes and cannot write this or anything else — see `agent-access-identity.ts`
 * and `agent-access-route-policy.ts`. Which of the two a request is comes from
 * the route, not from here; this module is handed the level and the grant that
 * decided it.
 */

/**
 * The plugin that serves `patcher browser`.
 *
 * Here rather than beside either of its two callers, because both of them are
 * about the same thing and neither owns it: `routes/system.ts` turns it on when
 * a person opens the browser to outside agents, and
 * `agent-access-route-policy.ts` names the one plugin CLI route a grant may
 * post to. A grant is for the browser, so the route it reaches is spelled with
 * this id in it rather than as `/plugins/:id/cli`.
 */
export const BROWSER_TOOLS_PLUGIN_ID = "browser-tools";

export interface BrowserExternalCallerScope {
  /** How far this install lets an agent outside Patcher go. */
  level: BrowserExternalAccessLevel;
  /**
   * The plugin whose CLI is running, for the refusal to name.
   *
   * The plugin rather than the command the caller typed, because the server
   * does not know that: `patcher browser` is proxied as the `browser-tools`
   * plugin's id, and the command name stays on the caller's side. So the
   * sentence says "the X plugin" rather than quoting it back as something to
   * re-run — measured on 2026-09-05, an earlier wording read
   * "`patcher browser-tools` ran a browser command", which is a command that
   * does not exist and the obvious thing for a reader to try next.
   */
  pluginId: string;
  /**
   * The grant this caller presented, when it presented one.
   *
   * Absent for a caller that holds the app key and no grant, which is the
   * install-wide `browserExternalAccess` setting's case and the one that came
   * first. Present, the level above is *this grant's* rather than the setting's,
   * and the refusal is a different sentence: what the reader has to change is a
   * grant somebody issued for them, not a global preference, and pointing them
   * at the wrong one costs a round trip through a person.
   */
  grant?: { id: string; label: string };
}

/**
 * `patcher browser` commands that do not drive the browser at all.
 *
 * The gate below charges *browser commands* — the messages that cross the wire
 * to the window — and that is the right unit for everything the plugin does
 * except this. `install-ffmpeg` runs Homebrew on the machine the **server** is
 * on, with the network and fifteen minutes, and never sends a browser command,
 * so nothing charged it and no level refused it. Measured on 2026-09-05: a
 * `read` grant, and an app-key caller with the level at `off`, both ran it to
 * completion while `tabs` was refused a line away.
 *
 * Refused to every caller from outside Patcher rather than priced into the
 * ramp, because no level should admit it: the ramp is about how far into the
 * user's *browsing session* an agent may reach, and installing software on the
 * host is not a point on it. Inside Patcher it is unaffected — a thread's gate
 * is the plugin toggle, which is a question about running plugin code at all.
 *
 * A list, because there is exactly one and a list of one is honest about that.
 * `browser-tools-surface.test.ts` is what keeps it complete: it runs every
 * command in the plugin's own table and fails if a new one runs to completion
 * without either reaching the browser or refusing on its arguments.
 */
const COMMANDS_THAT_ARE_NOT_THE_BROWSER: ReadonlyMap<string, string> = new Map([
  [
    "install-ffmpeg",
    "it installs software on the machine this server runs on, which is not something driving the browser can be allowed to do",
  ],
]);

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
  if (scope.grant !== undefined) {
    return (
      `The browser access grant "${scope.grant.label}" (${scope.grant.id}) allows "${scope.level}", ` +
      `and this command needs "${permission}". Nothing happened. The person at this machine can ` +
      `issue a wider grant with \`patcher agent-access grant --level ${needed}\`, and revoke this one ` +
      `in Patcher's Settings → General → Agents outside Patcher. Ask them rather than retrying: this ` +
      `is a decision, not a transient failure.`
    );
  }
  const current =
    scope.level === "off"
      ? "this install does not let agents outside Patcher drive the browser at all"
      : `this install allows them "${scope.level}"`;
  return (
    `The "${scope.pluginId}" plugin, driven from a terminal outside Patcher, ran a ` +
    `browser command needing "${permission}", and ${current}. ` +
    `Nothing happened. The person at this machine can allow it in Patcher's ` +
    `Settings → General → Agents outside Patcher, or by running \`patcher settings browser-access ${needed}\` ` +
    `in their own terminal. A narrower answer than the setting is \`patcher agent-access grant\`, which ` +
    `hands one agent a credential for the browser alone. Ask them rather than retrying: this is a ` +
    `decision, not a transient failure.`
  );
}

/**
 * Why this `patcher browser` argv is refused outright, or null.
 *
 * Charged at the route rather than at the bridge, because the whole point of
 * the commands it names is that they never reach the bridge. Takes the scope
 * explicitly rather than reading the ambient one: the route establishes the
 * scope around the *run*, and this decision has to be made before the run
 * starts.
 */
export function browserToolsArgvRefusal(
  scope: BrowserExternalCallerScope | undefined,
  argv: readonly string[],
): string | null {
  if (scope === undefined) return null;
  const reason = COMMANDS_THAT_ARE_NOT_THE_BROWSER.get(argv[0] ?? "");
  if (reason === undefined) return null;
  const who =
    scope.grant === undefined
      ? "an agent or terminal outside Patcher"
      : `the browser access grant "${scope.grant.label}"`;
  return (
    `\`patcher browser ${argv[0]}\` is refused to ${who}: ${reason}. Nothing happened, and no ` +
    `access level admits it — this is not a browser command. The person at this machine can run it ` +
    `in their own Patcher, or install it however this machine installs things.`
  );
}
