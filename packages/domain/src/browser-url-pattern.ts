/**
 * Which URLs a pattern claims, in the one dialect this repository uses.
 *
 * Playwright's URL glob: `**` crosses path separators, `*` stops at one, `?` is
 * a single character that is not a separator, and a pattern with no wildcard is
 * an exact URL. Route mocks were written in it first (a pattern copied out of
 * Playwright's documentation should mean here what it means there), and every
 * later surface that has to say *where* it applies reuses it rather than
 * inventing a second dialect for the same job.
 *
 * Zod-free on purpose: this is reached from the plugin API, which the
 * out-of-process plugin host loads, and importing `@patcher/domain`'s index there
 * costs ~38MB of RSS against a 90MB budget (see plugin-transport.md).
 *
 * Two properties this module is responsible for:
 *
 * - **A pattern is a pattern, not a program.** Patterns arrive as text from a
 *   plugin or a model and become a regular expression here. Every character
 *   that is not a wildcard is escaped, so a pattern containing `(`, `.` or `+`
 *   matches those characters rather than meaning something to the regex engine.
 * - **A site pattern says where, and the answer is checkable.** What a plugin
 *   declares in `patcher.sites` is the boundary the user consents to, so it is
 *   normalised once, here, rather than interpreted differently by each surface
 *   that honours it.
 */

/** Longest declarable site pattern; a URL glob is not a document. */
export const PLUGIN_SITE_PATTERN_MAX_LENGTH = 2_048;

/**
 * How many site patterns one plugin may declare. Generous — a plugin serving a
 * handful of internal tools is the case — and bounded because the list is shown
 * to the user before they install, and a list nobody reads is not consent.
 */
export const PLUGIN_SITE_PATTERN_MAX_COUNT = 32;

/**
 * The URL glob as a regular expression.
 *
 * Anchored at both ends: a pattern describes a whole URL, so `https://x.test/`
 * does not claim `https://x.test/admin` unless it says `**`.
 */
export function browserUrlPatternToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? "";
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        source += ".*";
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    // Everything else is a literal. Escaping is the whole point: a query string
    // is full of characters a regex would otherwise read as syntax.
    source += char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`^${source}$`, "u");
}

/**
 * Whether this pattern claims this URL.
 *
 * A pattern that will not compile matches nothing rather than throwing at the
 * call site: the callers are a network interceptor and a page-load hook, and
 * neither has anywhere useful to report a bad pattern to by the time it runs.
 * Registration is where a plugin hears about it.
 */
export function matchesBrowserUrlPattern(
  pattern: string,
  url: string,
): boolean {
  try {
    return browserUrlPatternToRegExp(pattern).test(url);
  } catch {
    return false;
  }
}

/**
 * A site pattern a plugin may declare in `patcher.sites` — normalised — or null when
 * it may not declare it at all.
 *
 * `https` only, with one exception: loopback over plain `http`, which is how a
 * developer's own service and Patcher's own pages are reached. Everything else is
 * refused for the reason a registered search engine's template is, except that
 * here the stake is higher: what a site pattern buys is standing access to a site
 * the user is signed in to, and plain http to another machine is a site anyone on
 * the path can impersonate.
 *
 * The scheme and host are read literally, so a wildcard may widen the host of an
 * `https` pattern (`https://*.github.com/**`) but never the scheme. An `http`
 * pattern with a wildcard in its host is refused rather than resolved
 * optimistically: `http://*.localhost/**` would otherwise have to be trusted to
 * stay loopback, and it does not.
 *
 * What "normalised" means here is one thing only: the **host is lower-cased**,
 * because matching is case-sensitive and a URL never arrives with an upper-case
 * host. The path is left alone — paths are case-sensitive on most servers, so
 * folding one would change which pages a pattern claims. Callers that decide
 * whether a pattern is *declarable* compare this against what was written:
 * `https://GitHub.com/**` is refusable rather than silently fixable, because the
 * declared string is what a registration's `matches` must equal verbatim.
 */
export function normalizePluginSitePattern(pattern: unknown): string | null {
  if (
    typeof pattern !== "string" ||
    pattern.length === 0 ||
    pattern.length > PLUGIN_SITE_PATTERN_MAX_LENGTH ||
    /\s/u.test(pattern)
  ) {
    return null;
  }
  if (pattern.startsWith("https://")) {
    const host = hostPartOf(pattern, "https://");
    return host.length > 0
      ? withLowercaseHost(pattern, "https://", host)
      : null;
  }
  if (pattern.startsWith("http://")) {
    const host = hostPartOf(pattern, "http://");
    return host.length > 0 && isLoopbackHostLiteral(host)
      ? withLowercaseHost(pattern, "http://", host)
      : null;
  }
  return null;
}

/** The pattern with its host folded to lower case, and nothing else touched. */
function withLowercaseHost(
  pattern: string,
  scheme: string,
  host: string,
): string {
  const lower = host.toLowerCase();
  return lower === host
    ? pattern
    : `${scheme}${lower}${pattern.slice(scheme.length + host.length)}`;
}

/** Everything between the scheme and the first `/`, port included. */
function hostPartOf(pattern: string, scheme: string): string {
  const rest = pattern.slice(scheme.length);
  const slash = rest.indexOf("/");
  return slash === -1 ? rest : rest.slice(0, slash);
}

/**
 * A host that is loopback and says so without being resolved — no wildcards, no
 * credentials, no trailing dot. Bracketed IPv6 arrives as `[::1]`.
 */
function isLoopbackHostLiteral(host: string): boolean {
  if (/[*?@]/u.test(host)) {
    return false;
  }
  const withoutPort = host.startsWith("[")
    ? (/^\[[^\]]*\]/u.exec(host)?.[0] ?? host)
    : (host.split(":")[0] ?? "");
  const name = withoutPort.toLowerCase().replace(/^\[|\]$/gu, "");
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name === "::1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(name)
  );
}
