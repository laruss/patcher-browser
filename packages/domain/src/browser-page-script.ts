/**
 * The plugin's own code, running in the pages of the sites the user declared it
 * may reach.
 *
 * The other half of {@link BrowserPageStyle}, and the more expensive one: a
 * stylesheet cannot read the page and cannot ask anything of the plugin, while
 * this can do both. So it takes its own permission (`pageScript.register`) over
 * the same `patcher.sites`, and everything the browser guarantees about running it is
 * written down here rather than left to be discovered.
 *
 * Measured against Electron 41.7.0 rather than assumed (the scripts run from a
 * sandboxed session preload; see docs/architecture/browser-surface.md):
 *
 * - **Before the page's own first script.** The code runs when the document has
 *   been created and the parser has produced *nothing* — `document.documentElement`
 *   is still null. That is earlier than a page style lands and earlier than any
 *   inline script on the page, which is the point: it can patch what the page is
 *   about to use. It also means DOM work has to wait, which is what `patcher.ready`
 *   is for.
 * - **A world of its own, per plugin.** Each plugin's scripts share one isolated
 *   world; the page's own world and every other plugin's are separate objects
 *   graphs. The page cannot see `patcher`, cannot see anything the script defines, and
 *   the script cannot be shadowed by globals the page redefines. Patcher's own
 *   automation world (the CDP one behind the agent tools) is a third world again
 *   and shares nothing with either.
 * - **Main frame only.** A session preload does not run in subframes unless the
 *   whole browsing session opts into `nodeIntegrationInSubFrames`, which would
 *   change every browsed page rather than the matching ones — so an iframe is
 *   out of reach, exactly as it is for a page style.
 * - **A new registration runs on the next load.** Scripts are read as a document
 *   is created, so a plugin installed while a matching page is open takes effect
 *   when that page is reloaded. Chrome's content scripts behave the same way.
 * - **A throwing script is contained.** The error lands in the page's console —
 *   where Patcher's observation log already collects it, so an agent can read it — and
 *   the next script still runs.
 *
 * Zod-free for the same reason as its neighbours: the plugin API validates
 * registrations and the out-of-process plugin host loads this module.
 */

export const BROWSER_PAGE_SCRIPT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/u;
export const BROWSER_PAGE_SCRIPT_MAX_ID_LENGTH = 64;

/**
 * Longest script one registration may carry. The same bound as a page style's
 * css, and for the same reason: every script rides the window's push to the
 * shell and is handed to a browsed renderer as text, so this is a declaration
 * rather than a place to ship a bundle.
 */
export const BROWSER_PAGE_SCRIPT_MAX_CODE_LENGTH = 64_000;

/** How many declared site patterns one script may select. */
export const BROWSER_PAGE_SCRIPT_MAX_MATCHES = 16;

/** A page script as the app holds it and the shell hands it to a page. */
export interface BrowserPageScript {
  pluginId: string;
  scriptId: string;
  /** Site patterns, each one the plugin declared in `patcher.sites`. */
  matches: string[];
  code: string;
}
