/**
 * CSS a plugin applies to the sites the user declared it may reach.
 *
 * The cheapest of the page contributions, and the one worth having first:
 * "remove that banner", "widen that column", "hide the feed" are one rule each,
 * they run no plugin code in the page, and they cannot read anything — so the
 * only question a user has to answer is *which sites*, which is the question
 * `patcher.sites` exists to put in front of them.
 *
 * What the browser guarantees about applying it is narrower than Chrome's
 * content scripts, and measured rather than assumed (Electron 41.7.0):
 *
 * - **One document.** Inserted CSS does not survive a navigation or a reload, so
 *   the shell re-applies it on every committed navigation. Nothing has to be
 *   removed when a tab leaves a matching site: the document it was attached to
 *   is already gone.
 * - **Main frame only.** A subframe keeps its own stylesheets, so an embedded
 *   ad in an iframe is not something a page style can reach.
 * - **After commit, not before first paint.** The earliest hook that works is
 *   the navigation committing; a page's own inline script running at the top of
 *   the document can still observe the unstyled state. In practice a rule lands
 *   before a network page has streamed the element it hides — but "in practice"
 *   is the honest word, and a style that must never be seen is not something
 *   this surface can promise.
 *
 * Zod-free, like {@link browserUrlPatternToRegExp}: the plugin API validates
 * registrations and the out-of-process host loads it.
 */

export const BROWSER_PAGE_STYLE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/u;
export const BROWSER_PAGE_STYLE_MAX_ID_LENGTH = 64;

/**
 * Longest stylesheet one registration may carry. Room for a real stylesheet and
 * not for a bundle: every style rides the window's push to the shell, and this is
 * a declaration, not an asset pipeline.
 */
export const BROWSER_PAGE_STYLE_MAX_CSS_LENGTH = 64_000;

/** How many declared host patterns one style may select. */
export const BROWSER_PAGE_STYLE_MAX_MATCHES = 16;

/** A page style as the app holds it and the shell applies it. */
export interface BrowserPageStyle {
  pluginId: string;
  styleId: string;
  /** Site patterns, each one the plugin declared in `patcher.sites`. */
  matches: string[];
  css: string;
}
