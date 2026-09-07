import type { BrowserCommandIssuer } from "@patcher/server-contract";
import {
  currentBrowserCommandIssuer,
  runAsBrowserCommandIssuer,
} from "./browser-command-issuer.js";
import {
  currentExternalBrowserCaller,
  runAsExternalBrowserCaller,
  type BrowserExternalCallerScope,
} from "./browser-external-access.js";

/**
 * Carrying the caller across the plugin boundary.
 *
 * The two scopes beside this — what an outside caller may do, and whose name
 * the window is shown — are `AsyncLocalStorage`, and both say the same thing
 * about their limit: they cover commands issued on the caller's own async
 * stack, which is every plugin running *in this process*. An installed plugin
 * runs in its own, and the host serves its browser call on a channel message,
 * in a fresh async context. So until this existed, a third-party plugin with
 * browser permissions and a CLI command of its own was a door the install-wide
 * setting did not close, and a command from one arrived at the window with
 * nobody's name on it however a person had started it.
 *
 * **The correlation is the host's own call id, and that is the whole design.**
 * The host already mints one per outbound request (`plugin-channel.ts`), and
 * it already makes that request on the caller's async stack — inside both
 * scopes, when there are any. So it records them under that id before the
 * frame goes out, the plugin's process quotes the id back on anything it sends
 * while serving the call, and the host looks the pair up again. Nothing about
 * the caller travels on the wire; what travels is an opaque id the host issued
 * and can only match against its own record.
 *
 * **What a plugin could still do with it, said plainly.** Both ends of a
 * `callId` are visible inside the plugin's process, so a plugin serving two
 * calls at once — a turn's agent tool and an outside terminal's CLI command —
 * could quote the wrong one and be charged the wrong caller's level. That is a
 * plugin lying about its own two invocations, not an outsider forging
 * anything, and it is not a way in: plugin code is a Node module with
 * `node:fs`, `child_process` and the loopback base URL
 * (`architecture/plugin-permissions.md`), so a plugin that wanted the browser
 * without being charged has a shorter path than this one. What this closes is
 * the case that needed no malice at all — an honest plugin, driven from a
 * terminal, reaching the browser because the scope could not follow it.
 *
 * **An unknown origin means no scope, which is what it meant before.** A frame
 * from an older plugin host, a background service's own work, a schedule's
 * tick: none of them are a caller, all of them arrive here with nothing to
 * find, and all of them keep running exactly as they did.
 */

export interface BrowserCallerHandoff {
  /** The level an outside caller is charged, when there is one. */
  scope?: BrowserExternalCallerScope;
  /** The name the window is shown, when the server can say one. */
  issuer?: BrowserCommandIssuer;
}

/**
 * Held for the life of one host→plugin request.
 *
 * Bounded by that: an entry is written when the request goes out and deleted
 * when it settles, and the channel settles everything it is holding when it
 * closes. A plugin process that dies mid-call takes its entries with it
 * through the same path.
 */
const inFlight = new Map<string, BrowserCallerHandoff>();

/**
 * Record who this call is for, keyed by the id the far side will quote back.
 *
 * Called by the channel for **every** outbound request, so the common answer
 * is "nobody" — the app's own work, a scheduler tick, a plugin loading. Those
 * write nothing at all, which is what keeps the map the size of the requests
 * that are actually somebody's rather than of all of them.
 */
export function rememberBrowserCaller(callId: string): () => void {
  const scope = currentExternalBrowserCaller();
  const issuer = currentBrowserCommandIssuer();
  if (scope === undefined && issuer === undefined) {
    return () => {};
  }
  inFlight.set(callId, {
    ...(scope === undefined ? {} : { scope }),
    ...(issuer === undefined ? {} : { issuer }),
  });
  return () => {
    inFlight.delete(callId);
  };
}

/**
 * Run `fn` as whoever the call named by `origin` was for.
 *
 * Both scopes together or neither, because they are two halves of one fact and
 * a command that is charged to a grant and named to nobody would be worse than
 * either alone. Nested in the same order the route nests them, so the two
 * paths cannot disagree about which is outermost.
 */
export function runAsRememberedBrowserCaller<T>(
  origin: string | undefined,
  fn: () => T,
): T {
  const remembered = origin === undefined ? undefined : inFlight.get(origin);
  if (remembered === undefined) return fn();
  const { scope, issuer } = remembered;
  const named = issuer === undefined ? fn : () => runAsBrowserCommandIssuer(issuer, fn);
  return scope === undefined ? named() : runAsExternalBrowserCaller(scope, named);
}

/**
 * How many calls are being held. For tests, and for the one thing no other
 * assertion can see: that an entry is dropped when its call settles.
 */
export function rememberedBrowserCallerCount(): number {
  return inFlight.size;
}
