// patcher-plugin-private-history — the `browser.history.filters` example.
//
// Two halves of the same permission, and they are deliberately different in
// kind:
//
//   * `patcher.browser.registerHistoryFilter` sees a page *before* it is recorded,
//     which is the only way to keep something out of the history at all. Here:
//     never record a host the user named, and strip tracking parameters from
//     everything else.
//   * `patcher.sdk.browserHistory` reads and edits what is already stored, which is
//     how a plugin cleans up after a rule that did not exist yet. Here: a
//     `patcher private-history forget` command.
//
// Worth reading next to examples/plugins/explain-selection: that one adds a
// surface the browser did not have, this one *changes* a decision the browser
// was already making. The browser has no idea what a private host is, and it
// does not need one — the rule lives in a plugin, and the setting that drives
// it belongs to the user.
//
// The type-only import is erased at load time; this file runs as-is.
import type {
  PatcherPluginApi,
  PluginBrowserHistoryRewrite,
} from "@patcher/plugin-sdk";

/**
 * Query parameters dropped from a URL before it is stored.
 *
 * A fixed list rather than a heuristic: guessing which parameters are tracking
 * would eventually break a real one, and a history entry whose URL no longer
 * loads the page is worse than one carrying a campaign tag.
 */
const TRACKING_PARAMETERS = [
  "fbclid",
  "gclid",
  "igshid",
  "mc_eid",
  "msclkid",
  "yclid",
];

/** `utm_source`, `utm_medium`, and everything else in that family. */
const TRACKING_PREFIX = "utm_";

const HOSTS_HINT =
  "Set hosts with `patcher plugin config private-history`, " +
  "then `patcher plugin reload private-history`.";

const USAGE = [
  "patcher private-history forget <text>   Delete stored entries matching <text>",
  "patcher private-history list [<text>]   Show what is stored",
].join("\n");

function parseHosts(value: string | undefined): readonly string[] {
  return (value ?? "")
    .split(/[\s,]+/u)
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
}

/** A host matches its own name and anything under it, never a suffix of it. */
function isPrivateHost(hostname: string, hosts: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return hosts.some(
    (candidate) => host === candidate || host.endsWith(`.${candidate}`),
  );
}

function stripTrackingParameters(url: URL): boolean {
  let changed = false;
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith(TRACKING_PREFIX) || TRACKING_PARAMETERS.includes(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  return changed;
}

export default async function plugin(patcher: PatcherPluginApi) {
  const settings = patcher.settings.define({
    hosts: {
      type: "string",
      label: "Private hosts",
      description:
        "Comma-separated hosts never recorded in history, subdomains included.",
    },
  });

  // Read once and follow changes, rather than awaiting settings inside the
  // filter: the filter runs on the write path of every page load and is
  // time-boxed, so it has no business doing I/O.
  let privateHosts = parseHosts((await settings.get()).hosts);
  settings.onChange((next) => {
    privateHosts = parseHosts(next.hosts);
  });
  if (privateHosts.length === 0) {
    // The tracking-parameter half still works, so this is a hint rather than a
    // refusal to load: the plugin does something useful unconfigured.
    patcher.status.needsConfiguration(HOSTS_HINT);
  }

  patcher.browser.registerHistoryFilter(
    (visit): PluginBrowserHistoryRewrite | null | void => {
      let url: URL;
      try {
        url = new URL(visit.url);
      } catch {
        // Not a URL this plugin understands (`about:`, a bare string). Deciding
        // nothing leaves it to the browser and to the other filters.
        return;
      }
      if (isPrivateHost(url.hostname, privateHosts)) {
        return null;
      }
      return stripTrackingParameters(url) ? { url: url.toString() } : undefined;
    },
  );

  // The third face of the same permission: what the store knows about the site in
  // front of the user, shown where they are already asking "what is this site?".
  // A rule that keeps a host out of history is visible here too — the section
  // says zero for a private host, which is the plugin working, not failing.
  patcher.browser.registerSiteInfoProvider({
    id: "history",
    label: "History",
    async describe(context: { host: string }) {
      if (context.host.length === 0) {
        return null;
      }
      // Matched by text, which is what the store can search — so this counts the
      // entries whose URL or title mentions the host rather than claiming to be
      // an exact per-origin count.
      const entries = await patcher.sdk.browserHistory.list({
        limit: 100,
        query: context.host,
      });
      return [
        { label: "Pages kept", value: String(entries.length) },
        ...(isPrivateHost(context.host, privateHosts)
          ? [{ label: "Recording", value: "off for this host" }]
          : []),
      ];
    },
  });

  patcher.cli.register({
    name: "private-history",
    summary: "Inspect and prune the browser's stored history",
    commands: [
      {
        name: "forget",
        summary: "Delete stored entries whose URL or title matches",
        usage: "patcher private-history forget <text>",
      },
      {
        name: "list",
        summary: "Show stored entries, optionally matching text",
        usage: "patcher private-history list [<text>]",
      },
    ],
    async run(argv) {
      const [command, ...rest] = argv;
      const query = rest.join(" ").trim();

      if (command === "list") {
        const entries = await patcher.sdk.browserHistory.list(
          query.length === 0 ? { limit: 20 } : { limit: 20, query },
        );
        return {
          exitCode: 0,
          stdout:
            entries.map((entry) => `${entry.url}`).join("\n") ||
            "Nothing stored.",
        };
      }

      if (command === "forget") {
        if (query.length === 0) {
          return { exitCode: 1, stderr: "forget requires text to match" };
        }
        const entries = await patcher.sdk.browserHistory.list({
          limit: 1000,
          query,
        });
        for (const entry of entries) {
          await patcher.sdk.browserHistory.remove({ id: entry.id });
        }
        return { exitCode: 0, stdout: `Forgot ${entries.length} entries.` };
      }

      return { exitCode: command === undefined ? 0 : 1, stdout: USAGE };
    },
  });
}
