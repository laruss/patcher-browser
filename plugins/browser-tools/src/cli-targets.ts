import type {
  PatcherPluginApi,
  PluginBrowserCallOptions,
} from "@patcher/plugin-sdk";

/**
 * What a caller typed, and what it meant.
 *
 * Both of these turn an argument into something the browser understands, and
 * both are guesses: `--tab` takes four spellings of one tab and `--url` takes
 * two of one address. They live outside `cli.ts` because a guess is worth
 * testing on its own — the shorthands are the part of this CLI an agent gets
 * wrong, and driving the whole command to ask whether a pattern matches costs a
 * fake browser to answer a question about a string.
 */

/**
 * Turn what a caller typed after `--tab` into a tab id.
 *
 * A tab id is `browser:<nanoid>:none` — 30-odd characters an agent has to carry
 * through every command in a chain, and mistype once to act on the wrong thing
 * or nothing. So four spellings are accepted, and only the first costs nothing:
 *
 * - a real tab id
 * - `active` — the tab the user is looking at, which is also the default
 * - an index from the `tabs` listing, counting from 1
 * - a substring of the URL or title, when exactly one tab matches
 *
 * The last three need the tab list, which is one extra call. A tab id in the
 * shape this browser mints (`browser:<id>:<scope>` — a colon is in none of the
 * other three spellings) skips it, so the precise form stays the cheap one;
 * anything else is matched against the list, an exact id first.
 */
export async function resolveTabTarget(
  patcher: PatcherPluginApi,
  target: string | undefined,
  options: PluginBrowserCallOptions,
): Promise<{ tabId: string | undefined } | { error: string }> {
  if (target === undefined) return { tabId: undefined };
  // Undefined rather than the active tab's id: every call already defaults to
  // the active tab, and resolving it here would cost a list for nothing.
  if (target === "active") return { tabId: undefined };
  if (target.includes(":")) return { tabId: target };

  const tabs = await patcher.browser.tabs.list(options);
  // An exact id wins over every other reading, so a tab whose id happens to
  // look like a number or to appear in another tab's URL is still addressable
  // by the id the browser gave it.
  if (tabs.some((tab) => tab.tabId === target)) return { tabId: target };
  const index = Number(target);
  if (Number.isInteger(index) && String(index) === target) {
    const tab = tabs[index - 1];
    if (tab === undefined) {
      return {
        error: `There is no tab ${index}; the browser has ${tabs.length}. Run \`patcher browser tabs\` for the list.`,
      };
    }
    return { tabId: tab.tabId };
  }

  const needle = target.toLowerCase();
  const matched = tabs.filter(
    (tab) =>
      tab.url.toLowerCase().includes(needle) ||
      (tab.title ?? "").toLowerCase().includes(needle),
  );
  if (matched.length === 1) return { tabId: matched[0]?.tabId };
  if (matched.length === 0) {
    return {
      error: `No open tab matches ${JSON.stringify(target)}. Run \`patcher browser tabs\` for the list.`,
    };
  }
  // Refusing rather than taking the first: acting on the wrong tab is a silent
  // wrong answer, and the caller has enough here to name the one it meant.
  return {
    error: `${matched.length} tabs match ${JSON.stringify(target)}:\n${matched
      .map((tab) => `  ${tab.tabId}\t${tab.url}`)
      .join("\n")}\nName one, or use its index from \`patcher browser tabs\`.`,
  };
}

/**
 * Whether a URL matches what a caller asked to wait for.
 *
 * A substring by default, because that is what gets typed (`--url x.com`), and
 * Playwright's glob when there is a `*` in it, because that is what gets typed
 * when a substring is not enough. Every non-wildcard character is escaped, so a
 * query string full of regex syntax matches itself.
 *
 * **A `*` is what makes it a glob, and only a `*`.** In the dialect this
 * repository writes URL patterns in (`@patcher/domain/browser-url-pattern`) a `?`
 * is a wildcard too — but a glob is anchored at both ends, and a `?` in
 * something typed after `--url` is the query separator: `--url "search?q=cats"`
 * used to become an anchored pattern and could never match
 * `https://example.com/search?q=cats`, the URL it is a substring of. It waited
 * out the full thirty seconds and exited 124 instead, which is the one answer
 * that reads as "the page never got there". Inside a pattern that *is* a glob
 * the `?` keeps its meaning — `--url "https://example.com/search?q=*"` is read
 * the way it would be read anywhere else here.
 */
export function urlMatches(url: string, pattern: string): boolean {
  if (!pattern.includes("*")) {
    return url.includes(pattern);
  }
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
    source += char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
  try {
    return new RegExp(`^${source}$`, "u").test(url);
  } catch {
    return false;
  }
}
