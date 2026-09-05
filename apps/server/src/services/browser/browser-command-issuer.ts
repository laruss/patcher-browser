import { AsyncLocalStorage } from "node:async_hooks";
import type { BrowserCommandIssuer } from "@patcher/server-contract";

/**
 * Carrying "who asked for this" from the request to the browser window.
 *
 * The gate beside this — `browser-external-access.ts` — asks whether a caller
 * may drive the browser, and having answered, forgets who it was. This carries
 * the same fact one step further, to the app, which is the only place a person
 * can be told. Electron draws no banner over a `WebContentsView`; what the app
 * puts in the browser chrome is the entire signal that something other than the
 * person is driving, and it cannot draw a name it was never sent.
 *
 * **The same ambient shape, and for the same reason.** The place that knows the
 * caller is the route; the place that sends the command is the bridge, with the
 * whole plugin surface in between. Passing an argument would put the field in
 * the plugin SDK, where a plugin could decline to pass it — a plugin that
 * dropped it would drive the browser anonymously, which is precisely the state
 * this ends. So it rides an `AsyncLocalStorage`, on the host's side of the
 * boundary.
 *
 * **Why the issuer is built by the caller rather than derived here.** It would
 * be one line to read the external scope and turn it into an issuer, and it
 * would be wrong in one place: a grant's level is a `BrowserAccessGrantLevel`
 * and the scope widens it to include `off`, which no grant has. Building the
 * issuer where the grant is still typed as a grant keeps the wire honest
 * without a runtime narrowing that could only ever be dead code.
 *
 * **What has no issuer.** The app's own browsing, a page script, a toolbar
 * item's handler, an installed plugin's background work: nothing a person did
 * not ask another agent for. That is the common case and it must stay silent —
 * an indicator that is on all the time says nothing.
 */

const storage = new AsyncLocalStorage<BrowserCommandIssuer>();

/**
 * Run `fn` with every browser command it issues attributed to `issuer`.
 *
 * Only wrap the work of a request that really is one, the same discipline the
 * access scope is held to: a scope left over the app's own call would put a
 * name in the chrome for something the user did themselves.
 */
export function runAsBrowserCommandIssuer<T>(
  issuer: BrowserCommandIssuer,
  fn: () => T,
): T {
  return storage.run(issuer, fn);
}

/** Who this call is for, or undefined for the app's own work. */
export function currentBrowserCommandIssuer():
  | BrowserCommandIssuer
  | undefined {
  return storage.getStore();
}
