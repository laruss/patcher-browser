/**
 * Which search engine the browser's address bar uses, and who may add one.
 *
 * The engine is a **template**, not a provider, and that is the load-bearing
 * decision. What Enter does is resolved synchronously from the typed text —
 * deliberately, so pressing it before the omnibox's debounce elapses does the
 * same thing as pressing it after — so the winner has to be data the app already
 * holds, never something it has to go and ask for. Declared, like context-menu
 * items, for the same reason.
 *
 * The consequence worth stating: an engine need not be a search engine. Any
 * `https` (or loopback) address with a placeholder in it is one, including a
 * plugin's own route that spawns an agent thread — which is the thing an
 * agent-first browser wants from its address bar.
 */
export const BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER = "%s";

export const BROWSER_SEARCH_ENGINE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/u;
export const BROWSER_SEARCH_ENGINE_MAX_ID_LENGTH = 64;
export const BROWSER_SEARCH_ENGINE_MAX_NAME_LENGTH = 64;
export const BROWSER_SEARCH_ENGINE_MAX_TEMPLATE_LENGTH = 2_048;

export interface BrowserSearchEngine {
  /** Stable across restarts: it is what the setting stores. */
  id: string;
  /** Shown in the setting's list. */
  name: string;
  /** Absolute URL with {@link BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER} in it. */
  urlTemplate: string;
}

/**
 * The engines Patcher ships. Google stays first because it is what every build
 * searched with before there was a choice, so nobody's address bar changes
 * behaviour by upgrading.
 *
 * A short list on purpose: the point of `registerSearchEngine` is that the list
 * is not Patcher's to curate. These three are here so the setting is usable with no
 * plugin installed at all.
 */
export const BUILT_IN_BROWSER_SEARCH_ENGINES: readonly BrowserSearchEngine[] = [
  {
    id: "google",
    name: "Google",
    urlTemplate: `https://www.google.com/search?q=${BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER}`,
  },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    urlTemplate: `https://duckduckgo.com/?q=${BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER}`,
  },
  {
    id: "yandex",
    name: "Yandex",
    urlTemplate: `https://yandex.ru/search/?text=${BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER}`,
  },
];

export const DEFAULT_BROWSER_SEARCH_ENGINE_ID = "google";

/**
 * The template a plugin may register, or null when it may not.
 *
 * `https` only, with one exception: loopback, which is how Patcher serves its own
 * pages and the only way a plugin's route can be an engine. Everything else is
 * refused — a search is every word the user types into the address bar, and
 * sending that over plain http to another machine is not a choice a plugin gets
 * to make on the user's behalf.
 */
export function normalizeBrowserSearchEngineTemplate(
  template: unknown,
): string | null {
  if (
    typeof template !== "string" ||
    template.length === 0 ||
    template.length > BROWSER_SEARCH_ENGINE_MAX_TEMPLATE_LENGTH ||
    /\s/u.test(template) ||
    !template.includes(BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER)
  ) {
    return null;
  }
  let parsed: URL;
  try {
    // With the placeholder still in it: it sits in a query value or a path
    // segment, and `%s` is a legal character sequence in both.
    parsed = new URL(template);
  } catch {
    return null;
  }
  if (parsed.protocol === "https:") {
    return template;
  }
  if (parsed.protocol === "http:" && isLoopbackSearchHost(parsed.hostname)) {
    return template;
  }
  return null;
}

/** Bracketed IPv6 arrives from `URL.hostname` as `[::1]`. */
function isLoopbackSearchHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host)
  );
}

/** The engine a stored id names, falling back to the built-in default. */
export function resolveBrowserSearchEngine(args: {
  engineId: string | null;
  engines: readonly BrowserSearchEngine[];
}): BrowserSearchEngine {
  const fallback =
    args.engines.find(
      (engine) => engine.id === DEFAULT_BROWSER_SEARCH_ENGINE_ID,
    ) ?? BUILT_IN_BROWSER_SEARCH_ENGINES[0];
  if (fallback === undefined) {
    throw new Error("Patcher ships at least one search engine");
  }
  if (args.engineId === null) {
    return fallback;
  }
  // A setting can name an engine a plugin has since been removed with, and the
  // honest answer is to search with Patcher's own rather than to fail on Enter.
  return args.engines.find((engine) => engine.id === args.engineId) ?? fallback;
}

/** The engine's URL for `query`. */
export function buildBrowserSearchUrl(
  query: string,
  urlTemplate: string,
): string {
  return urlTemplate.replaceAll(
    BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER,
    encodeURIComponent(query),
  );
}
