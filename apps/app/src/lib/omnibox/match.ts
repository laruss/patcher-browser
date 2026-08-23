// Text matching shared by the providers that filter an existing list (open
// tabs, history). Deliberately crude: a prefix beats a substring, everything
// else scores zero. Fuzzy matching is a later question, and a wrong fuzzy
// ranking is harder to explain than a missing row.

/** A prefix match on any candidate field. */
const OMNIBOX_PREFIX_MATCH = 1;
/** A match somewhere inside a candidate field. */
const OMNIBOX_SUBSTRING_MATCH = 0.65;

export interface ScoreOmniboxTextMatchArgs {
  /** Title, host, URL — whichever the provider has; nulls are skipped. */
  candidates: readonly (string | null)[];
  query: string;
}

/**
 * How well `query` matches the best of `candidates`, in [0, 1]. Providers
 * multiply this by their own weight so a provider's ceiling stays below the
 * default action's score.
 */
export function scoreOmniboxTextMatch(args: ScoreOmniboxTextMatchArgs): number {
  const query = args.query.trim().toLowerCase();
  if (query.length === 0) {
    return 0;
  }

  let best = 0;
  for (const candidate of args.candidates) {
    if (candidate === null || candidate.length === 0) {
      continue;
    }
    const value = candidate.toLowerCase();
    if (value.startsWith(query)) {
      return OMNIBOX_PREFIX_MATCH;
    }
    if (value.includes(query)) {
      best = Math.max(best, OMNIBOX_SUBSTRING_MATCH);
    }
  }
  return best;
}

/**
 * Match candidates for a URL: the host on its own, and the URL without its
 * scheme — so typing `gith` or `github.com/laruss` both hit
 * `https://github.com/laruss/patcher-browser`, which a raw-URL prefix test would miss
 * because the user does not type `https://`.
 */
export function omniboxUrlMatchCandidates(url: string): readonly string[] {
  const withoutScheme = url.replace(/^https?:\/\//iu, "");
  const host = withoutScheme.split(/[/?#]/u)[0] ?? "";
  const withoutWww = host.startsWith("www.") ? host.slice(4) : null;
  return withoutWww === null
    ? [host, withoutScheme]
    : [host, withoutWww, withoutScheme];
}
