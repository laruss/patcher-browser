// patcher-plugin-omnibox-agent — the `browser.omnibox.providers` example (no frontend).
//
// Type into the browser surface's omnibox and this plugin adds two kinds of row
// to the same ranked list the browser fills with address, search, open-tab and
// history rows:
//
//   - "Ask an agent: <query>"     → a `run` action: spawns a Patcher thread with the
//                                   query as its prompt and opens that thread in
//                                   the tab the omnibox was used from.
//   - "Search GitHub for <query>" → a `navigate` action, resolved by the browser
//                                   without calling back into the plugin.
//
// It also registers itself as a **search engine**, which is the same idea taken
// one step further: instead of a row you have to pick, Enter itself goes to the
// agent. A search engine is a URL template the browser formats, so the engine
// points at this plugin's own loopback route — which spawns the thread and
// redirects the tab to it.
//
// Surfaces demonstrated: patcher.browser.registerOmniboxProvider (both action kinds),
// patcher.browser.registerSearchEngine (including an engine that is not a search
// engine), patcher.http.route, a `project` setting with patcher.status.needsConfiguration,
// patcher.sdk.threads.spawn with plugin attribution, and patcher.server.loopbackBaseUrl to
// point the browser at the Patcher app the plugin itself runs inside.
//
// The type-only import is erased at load time; this file runs as-is.
import type { PatcherPluginApi } from "@patcher/plugin-sdk";

const CONFIGURE_HINT =
  "Set project with `patcher plugin config omnibox-agent`, " +
  "then `patcher plugin reload omnibox-agent`.";

/** The one item id this provider's `run` action answers to. */
const ASK_ITEM_ID = "ask";

function githubSearchUrl(query: string): string {
  return `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`;
}

export default async function plugin(patcher: PatcherPluginApi) {
  const settings = patcher.settings.define({
    project: {
      type: "project",
      label: "Patcher project for omnibox asks",
      description: '"Ask an agent" spawns threads in this project.',
    },
  });

  // Unconfigured is a first-class state: the navigate row still works, so the
  // plugin is useful before anyone touches its settings.
  const initial = await settings.get();
  if (!initial.project) {
    patcher.status.needsConfiguration(CONFIGURE_HINT);
  }

  // The engine's other half: the browser navigates here with the query, and this
  // turns it into a thread. A plain `https` engine needs none of this — see the
  // Kagi registration below — but an engine that *does* something needs somewhere
  // to do it.
  patcher.http.route("GET", "/ask", async (context) => {
    // A Hono context, so the query comes off the request rather than a parsed URL.
    const query = (context.req.query("q") ?? "").trim();
    if (query.length === 0) {
      return new Response("Nothing to ask.", { status: 400 });
    }
    const current = await settings.get();
    if (!current.project) {
      return new Response(
        `omnibox-agent is not configured. ${CONFIGURE_HINT}`,
        {
          status: 503,
        },
      );
    }
    const thread = await patcher.sdk.threads.spawn({
      projectId: current.project,
      prompt: query,
      environment: { type: "project-default" },
      title: `Omnibox: ${query.slice(0, 60)}`,
    });
    patcher.log.info(`search engine ask → thread ${thread.id}`);
    // A redirect rather than a page: the tab should end up on the thread, the way
    // a search engine leaves you on its results.
    return new Response(null, {
      status: 302,
      headers: {
        location: `${patcher.server.loopbackBaseUrl}/threads/${thread.id}`,
      },
    });
  });

  patcher.browser.registerSearchEngine({
    id: "ask-agent",
    name: "Ask an agent",
    // Loopback is admitted for exactly this: an engine served by the machine the
    // browser is running on. `%s` is where the browser puts the escaped query.
    urlTemplate: `${patcher.server.loopbackBaseUrl}/api/v1/plugins/omnibox-agent/http/ask?q=%s`,
  });

  // And an ordinary one, to show that most engines are just a template.
  patcher.browser.registerSearchEngine({
    id: "kagi",
    name: "Kagi",
    urlTemplate: "https://kagi.com/search?q=%s",
  });

  patcher.browser.registerOmniboxProvider({
    // Wire item ids are "<providerId>:<item id>", so rows read as
    // "agent:ask" / "agent:github".
    id: "agent",
    // Shown as the row's source, so a user can tell a plugin row from the
    // browser's own.
    label: "Agent",
    async suggest({ query }) {
      // Read settings per call rather than closing over the load-time value:
      // they can change without a reload.
      const current = await settings.get();
      return [
        // Above the site search but below 1: the browser's default action — what
        // Enter does with nothing selected — always keeps the top row.
        ...(current.project
          ? [
              {
                id: ASK_ITEM_ID,
                title: `Ask an agent: ${query}`,
                subtitle: "spawns a Patcher thread",
                score: 0.8,
                action: { type: "run" } as const,
              },
            ]
          : []),
        {
          id: "github",
          title: `Search GitHub for "${query}"`,
          subtitle: "github.com",
          score: 0.55,
          action: { type: "navigate", url: githubSearchUrl(query) } as const,
        },
      ];
    },
    async run(itemId, { query }) {
      if (itemId !== ASK_ITEM_ID) {
        throw new Error(`unknown omnibox item ${JSON.stringify(itemId)}`);
      }
      const current = await settings.get();
      if (!current.project) {
        throw new Error(`omnibox-agent is not configured. ${CONFIGURE_HINT}`);
      }
      // Patcher fills in origin "plugin" and originPluginId automatically, so the
      // thread is attributed to this plugin in the thread list.
      const thread = await patcher.sdk.threads.spawn({
        projectId: current.project,
        prompt: query,
        environment: { type: "project-default" },
        title: `Omnibox: ${query.slice(0, 60)}`,
      });
      patcher.log.info(`omnibox ask → thread ${thread.id}`);
      // Open the new thread in the tab the omnibox was used from: the browser
      // navigates to the Patcher app served by the server this plugin runs in.
      return {
        navigate: `${patcher.server.loopbackBaseUrl}/threads/${thread.id}`,
      };
    },
  });
}
