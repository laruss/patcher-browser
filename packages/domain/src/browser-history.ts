/**
 * Limits for the browser's history store.
 *
 * The store lives on the server (`browser_history_entries`), which is what
 * makes these numbers worth writing down: the list used to be 24 rows of
 * localStorage, small enough that nothing needed a policy. A durable store
 * needs one, because nobody prunes their own browsing history.
 *
 * Here rather than in the wire contract because `@patcher/db` enforces the cap on
 * insert and cannot see `@patcher/server-contract`.
 */

/**
 * How many entries survive. Oldest visits are dropped on insert once the store
 * is over, so the cost of the cap is paid by whoever caused it.
 *
 * A URL is one row per scope no matter how often it is visited, so this is
 * "distinct pages", not "page views" — 10k of them is years of browsing for
 * the surface this ships on, and roughly a megabyte of SQLite.
 */
export const BROWSER_HISTORY_MAX_ENTRIES = 10_000;

/** Longest search string the history query accepts. */
export const BROWSER_HISTORY_QUERY_MAX_LENGTH = 256;

/** Most entries one read can ask for. */
export const BROWSER_HISTORY_LIMIT_MAX = 1_000;

/** What a read returns when it does not say. */
export const BROWSER_HISTORY_DEFAULT_LIMIT = 200;

/** Longest URL recorded; longer visits are refused rather than truncated. */
export const BROWSER_HISTORY_URL_MAX_LENGTH = 4_096;

/** Longest page title stored; longer ones are cut to fit. */
export const BROWSER_HISTORY_TITLE_MAX_LENGTH = 1_024;

/** Longest scope id accepted — a thread id, or the browser surface's own. */
export const BROWSER_HISTORY_SCOPE_ID_MAX_LENGTH = 256;
