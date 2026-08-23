import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestThreadSequence, getThread } from "@patcher/db";
import { turnScope } from "@patcher/domain";
import { threadTimelineResponseSchema } from "@patcher/server-contract";
import {
  generatedSkillsRootPath,
  pluginCommandsSkillDir,
} from "../../../src/services/plugins/plugin-commands-skill.js";
import { resolveInjectedSkillSources } from "../../../src/services/skills/injected-skills.js";
import { applyLoggedThreadLifecycleEvent } from "../../../src/services/threads/lifecycle-outcome.js";
import {
  seedEvent,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../../helpers/seed.js";
import {
  createTestAppHarness,
  startTestServer,
  testLogger,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";

/** The repo's real hero example plugins — installed exactly as shipped. */
const EXAMPLES_DIR = fileURLToPath(
  new URL("../../../../../examples/plugins", import.meta.url),
);

// The examples pin engines.patcher to ">=0.9"; the harness default app version
// ("0.0.0-test") would legitimately mark them incompatible.
const APP_VERSION = "1.0.0";

function slackHeaders(
  signingSecret: string,
  rawBody: string,
): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature =
    "v0=" +
    createHmac("sha256", signingSecret)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex");
  return {
    "content-type": "application/json",
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": signature,
  };
}

describe("hero plugin: agent-enrichment", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness({ appVersion: APP_VERSION });
    const entry = await harness.pluginService.installPath(
      join(EXAMPLES_DIR, "agent-enrichment"),
    );
    expect(entry.id).toBe("agent-enrichment");
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  async function runDocs(argv: string[]): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/agent-enrichment/cli`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ argv }),
      },
    );
    expect(response.status).toBe(200);
    return (await response.json()) as {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
  }

  it("patcher docs search returns excerpts from the bundled docs via the CLI endpoint", async () => {
    const result = await runDocs(["search", "conventional commits"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("conventions.md");
    expect(result.stdout).toContain("conventional commits");

    // The kv cache backs `patcher docs last`.
    const last = await runDocs(["last"]);
    expect(last.exitCode).toBe(0);
    expect(last.stdout).toContain('"conventional commits"');
  });

  it("the caseSensitive boolean setting changes search behavior without a reload", async () => {
    const insensitive = await runDocs(["search", "CONVENTIONAL COMMITS"]);
    expect(insensitive.stdout).toContain("conventions.md");

    await harness.pluginService.updateSettings("agent-enrichment", {
      caseSensitive: true,
    });
    const sensitive = await runDocs(["search", "CONVENTIONAL COMMITS"]);
    expect(sensitive.exitCode).toBe(0);
    expect(sensitive.stdout).toContain("No matches");
  });

  it("its command reaches agents through the generated plugin-commands skill", async () => {
    const skillFile = join(
      pluginCommandsSkillDir(harness.config.dataDir),
      "SKILL.md",
    );
    const content = await readFile(skillFile, "utf8");
    expect(content).toContain("## patcher docs —");
    expect(content).toContain("patcher docs search <query...>");

    // Resolved the same way thread-runtime-config wires the generated root.
    const sources = resolveInjectedSkillSources(testLogger, {
      additionalSkillsRootPaths: [
        generatedSkillsRootPath(harness.config.dataDir),
      ],
      builtinSkillsRootPath: join(harness.config.dataDir, "builtin-skills"),
      dataDir: harness.config.dataDir,
      skillTreeRegistry: harness.deps.skillTreeRegistry,
    });
    expect(
      sources.find((source) => source.name === "plugin-commands"),
    ).toMatchObject({ kind: "tree", entryPath: "SKILL.md" });
  });

  it("auto-imports its skills/ directory through the plugin skills tier", () => {
    const pluginSkillRoots = harness.pluginService.listSkillRootContributions();
    expect(pluginSkillRoots).toContainEqual(
      expect.objectContaining({
        rootPath: join(EXAMPLES_DIR, "agent-enrichment", "skills"),
      }),
    );
    // Resolved the same way thread-runtime-config wires the plugin tier.
    const sources = resolveInjectedSkillSources(testLogger, {
      builtinSkillsRootPath: join(harness.config.dataDir, "builtin-skills"),
      dataDir: harness.config.dataDir,
      pluginSkillRoots,
      skillTreeRegistry: harness.deps.skillTreeRegistry,
    });
    const skill = sources.find((source) => source.name === "repo-conventions");
    expect(skill).toBeDefined();
    expect(skill?.description).toContain("Conventions");
    expect(skill).toMatchObject({ kind: "tree", entryPath: "SKILL.md" });
  });
});

describe("hero plugin: slack-bot", () => {
  it("webhook → spawn → thread.idle → chat.postMessage, end to end", async () => {
    const server = await startTestServer({ appVersion: APP_VERSION });
    const realFetch = globalThis.fetch;
    const slackCalls: Array<{ url: string; body: Record<string, unknown> }> =
      [];
    try {
      const { host } = seedHostSession(server.deps);
      seedPrimaryHost(server.deps, host.id);
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
        path: "/tmp/slack-bot-hero-source",
      });

      // Mock ONLY the outbound Slack Web API (the true external boundary);
      // everything else — including the plugin's loopback patcher.sdk calls —
      // passes through to the real fetch.
      globalThis.fetch = (async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.startsWith("https://slack.com/")) {
          slackCalls.push({
            url,
            body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          });
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" },
          });
        }
        return realFetch(input, init);
      }) as typeof fetch;

      server.pluginService.bindSdk({ baseUrl: server.baseUrl });
      const entry = await server.pluginService.installPath(
        join(EXAMPLES_DIR, "slack-bot"),
      );
      expect(entry.id).toBe("slack-bot");
      // Unconfigured: loaded, but honestly reporting what it needs.
      expect(entry.status).toBe("needs-configuration");
      expect(entry.statusDetail).toContain("patcher plugin config slack-bot");

      // Configure (as `patcher plugin config slack-bot set ...` would) + reload.
      const signingSecret = "test-signing-secret";
      await server.pluginService.updateSettings("slack-bot", {
        botToken: "xoxb-test-token",
        signingSecret,
        channelId: "C0GENERAL",
        project: project.id,
      });
      await server.pluginService.reload("slack-bot");
      expect(
        server.pluginService.list().find((p) => p.id === "slack-bot")?.status,
      ).toBe("running");

      const eventsUrl = `${server.baseUrl}/api/v1/plugins/slack-bot/http/events`;

      // An unsigned request never reaches the event handlers.
      const forged = await realFetch(eventsUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
          "x-slack-signature": "v0=deadbeef",
        },
        body: JSON.stringify({ type: "url_verification", challenge: "nope" }),
      });
      expect(forged.status).toBe(401);

      // Slack's URL-verification handshake round-trips the challenge.
      const challengeBody = JSON.stringify({
        type: "url_verification",
        challenge: "challenge-123",
      });
      const verification = await realFetch(eventsUrl, {
        method: "POST",
        headers: slackHeaders(signingSecret, challengeBody),
        body: challengeBody,
      });
      expect(verification.status).toBe(200);
      expect(await verification.json()).toEqual({
        challenge: "challenge-123",
      });

      // An app_mention spawns an attributed Patcher thread and records the
      // Slack-thread ↔ Patcher-thread mapping in kv.
      const mentionBody = JSON.stringify({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C0GENERAL",
          text: "<@U0BOT> summarize the release notes",
          ts: "1720000000.000100",
        },
      });
      const mention = await realFetch(eventsUrl, {
        method: "POST",
        headers: slackHeaders(signingSecret, mentionBody),
        body: mentionBody,
      });
      expect(mention.status).toBe(200);
      expect(await mention.json()).toEqual({ ok: true });

      const api = server.pluginService.getApi("slack-bot");
      expect(api).toBeDefined();
      const threadId = await api?.storage.kv.get<string>(
        "slack:1720000000.000100",
      );
      expect(threadId).toBeDefined();
      const threadRow = getThread(server.db, threadId as string);
      expect(threadRow?.originPluginId).toBe("slack-bot");
      expect(threadRow?.title).toBe("Slack: summarize the release notes");

      // Drive the spawned thread to idle through the real lifecycle seam
      // (no live provider in tests) with an assistant message on record.
      const lifecycleDeps = {
        db: server.db,
        hub: server.hub,
        logger: testLogger,
      };
      applyLoggedThreadLifecycleEvent(lifecycleDeps, {
        threadId: threadId as string,
        event: { type: "run.started" },
      });
      seedEvent(server.deps, {
        threadId: threadId as string,
        environmentId: threadRow?.environmentId ?? null,
        providerThreadId: "provider-slack-1",
        scope: turnScope("turn-1"),
        sequence:
          getLatestThreadSequence(server.db, {
            threadId: threadId as string,
          }) + 1,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "assistant-1",
            text: "Release notes: all green.",
          },
        },
      });
      const outcome = applyLoggedThreadLifecycleEvent(lifecycleDeps, {
        threadId: threadId as string,
        event: { type: "run.succeeded" },
      });
      expect(outcome.applied).toBe(true);

      // thread.idle → chat.postMessage into the originating Slack thread.
      await vi.waitFor(() => expect(slackCalls).toHaveLength(1));
      expect(slackCalls[0]?.url).toBe("https://slack.com/api/chat.postMessage");
      expect(slackCalls[0]?.body).toEqual({
        channel: "C0GENERAL",
        thread_ts: "1720000000.000100",
        text: "Release notes: all green.",
      });

      // The failure-isolation stats saw the handler and recorded no errors.
      const listed = server.pluginService
        .list()
        .find((p) => p.id === "slack-bot");
      expect(listed?.handlerStats.errorCount).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
      await server.pluginService.stop();
      await server.close();
    }
  });
});

describe("hero plugin: omnibox-agent", () => {
  it("contributes omnibox rows, and a picked ask spawns an attributed thread", async () => {
    const server = await startTestServer({ appVersion: APP_VERSION });
    try {
      const { host } = seedHostSession(server.deps);
      seedPrimaryHost(server.deps, host.id);
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
        path: "/tmp/omnibox-agent-hero-source",
      });
      server.pluginService.bindSdk({ baseUrl: server.baseUrl });

      const suggest = async (query: string) => {
        const response = await fetch(
          `${server.baseUrl}/api/v1/plugins/omnibox/suggest?q=${encodeURIComponent(query)}`,
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          groups: Array<{
            items: Array<{ itemId: string; score: number; action: unknown }>;
            label: string;
            providerId: string;
          }>;
        };
        return body.groups;
      };

      const entry = await server.pluginService.installPath(
        join(EXAMPLES_DIR, "omnibox-agent"),
      );
      expect(entry.id).toBe("omnibox-agent");
      // Unconfigured: loaded, but honestly reporting what it needs.
      expect(entry.status).toBe("needs-configuration");
      expect(entry.statusDetail).toContain(
        "patcher plugin config omnibox-agent",
      );

      // The navigate row needs no configuration, so the plugin contributes to
      // the omnibox before anyone opens its settings.
      const unconfigured = await suggest("flaky tests");
      expect(unconfigured).toHaveLength(1);
      expect(unconfigured[0]?.label).toBe("Agent");
      expect(unconfigured[0]?.items.map((item) => item.itemId)).toEqual([
        "agent:github",
      ]);

      // Configure (as `patcher plugin config omnibox-agent set ...` would) + reload:
      // the omnibox gains a row with no browser-core change.
      await server.pluginService.updateSettings("omnibox-agent", {
        project: project.id,
      });
      await server.pluginService.reload("omnibox-agent");
      expect(
        server.pluginService.list().find((p) => p.id === "omnibox-agent")
          ?.status,
      ).toBe("running");

      const configured = await suggest("flaky tests");
      expect(configured[0]?.items.map((item) => item.itemId)).toEqual([
        "agent:ask",
        "agent:github",
      ]);
      expect(configured[0]?.items[0]?.action).toEqual({ type: "run" });
      // Below 1: the browser's own default action keeps the top row.
      expect(configured[0]?.items[0]?.score).toBeLessThan(1);

      // Picking the ask row runs the plugin, which spawns a Patcher thread through
      // its loopback SDK and hands the browser the thread's URL to open.
      const run = await fetch(`${server.baseUrl}/api/v1/plugins/omnibox/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: "agent:ask",
          pluginId: "omnibox-agent",
          query: "flaky tests",
        }),
      });
      expect(run.status).toBe(200);
      const runBody = (await run.json()) as { navigate: string; ok: boolean };
      expect(runBody.ok).toBe(true);
      expect(runBody.navigate.startsWith(`${server.baseUrl}/threads/`)).toBe(
        true,
      );

      const threadId = runBody.navigate.split("/threads/")[1] ?? "";
      const threadRow = getThread(server.db, threadId);
      expect(threadRow?.originPluginId).toBe("omnibox-agent");
      expect(threadRow?.title).toBe("Omnibox: flaky tests");

      const listed = server.pluginService
        .list()
        .find((p) => p.id === "omnibox-agent");
      expect(listed?.handlerStats.errorCount).toBe(0);
    } finally {
      await server.pluginService.stop();
      await server.close();
    }
  });
});

describe("hero plugin: bookmarks", () => {
  // The Phase 8 chrome surfaces, end to end against the real host: the star's
  // state, the press that toggles it, and the list a new tab shows. No browser is
  // involved — these are the three routes the app calls, which is exactly the
  // seam a plugin can be trusted on without an Electron window.
  it("saves a page from the star, and the new-tab list shows it", async () => {
    const server = await startTestServer({ appVersion: APP_VERSION });
    try {
      const entry = await server.pluginService.installPath(
        join(EXAMPLES_DIR, "bookmarks"),
      );
      expect(entry.id).toBe("bookmarks");
      // Nothing to configure: a bookmarks store needs no setting to be useful.
      expect(entry.status).toBe("running");

      const contributions = (await (
        await fetch(`${server.baseUrl}/api/v1/plugins/contributions`)
      ).json()) as {
        browserNewTabWidgets: { pluginId: string; widgetId: string }[];
        browserToolbarItems: { itemId: string; hasState: boolean }[];
        commands: { commandId: string; shortcut: { key: string } }[];
      };
      expect(contributions.browserToolbarItems).toEqual([
        {
          pluginId: "bookmarks",
          itemId: "star",
          title: "Save this page",
          icon: "Star",
          hasState: true,
        },
      ]);
      expect(contributions.browserNewTabWidgets).toEqual([
        { pluginId: "bookmarks", widgetId: "saved" },
      ]);
      expect(contributions.commands).toEqual([
        {
          pluginId: "bookmarks",
          commandId: "toggle",
          title: "Bookmark this page",
          shortcut: {
            key: "d",
            alt: false,
            control: false,
            meta: false,
            mod: true,
            shift: false,
          },
        },
      ]);

      const url = "https://example.test/docs";
      const state = async () => {
        const response = await fetch(
          `${server.baseUrl}/api/v1/plugins/browser/toolbar-state?tabId=browser:a&url=${encodeURIComponent(url)}`,
        );
        return (await response.json()) as {
          states: { active: boolean; title: string | null }[];
        };
      };
      const newTab = async () => {
        const response = await fetch(
          `${server.baseUrl}/api/v1/plugins/browser/new-tab?tabId=browser:a`,
        );
        return (await response.json()) as {
          sections: { label: string; rows: { title: string; url: string }[] }[];
        };
      };
      const press = async () =>
        fetch(`${server.baseUrl}/api/v1/plugins/browser/toolbar-item`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            pluginId: "bookmarks",
            itemId: "star",
            tabId: "browser:a",
            url,
            title: "The docs",
          }),
        });

      // Nothing saved: an empty star, and a new tab that looks like it always did.
      expect((await state()).states).toEqual([]);
      expect((await newTab()).sections).toEqual([]);

      expect((await press()).status).toBe(200);

      expect((await state()).states).toEqual([
        {
          pluginId: "bookmarks",
          itemId: "star",
          active: true,
          title: "Remove from bookmarks",
        },
      ]);
      expect((await newTab()).sections).toEqual([
        {
          pluginId: "bookmarks",
          widgetId: "saved",
          label: "Bookmarks",
          rows: [{ title: "The docs", subtitle: null, url }],
        },
      ]);

      // The same press again is the way back out — one store behind every entrance.
      expect((await press()).status).toBe(200);
      expect((await state()).states).toEqual([]);
      expect((await newTab()).sections).toEqual([]);

      const listed = server.pluginService
        .list()
        .find((plugin) => plugin.id === "bookmarks");
      expect(listed?.handlerStats.errorCount).toBe(0);
    } finally {
      await server.pluginService.stop();
      await server.close();
    }
  });
});

describe("hero plugin: explain-selection", () => {
  // Plan §22's second end-to-end scenario, and §18 Phase 6's deliverable: a
  // plugin is installed, it registers a context-menu item, the user selects text
  // and picks it, and an agent receives the selected text. Nothing here is
  // hardcoded for the demo — every step goes through the shipped surfaces.
  it("installs, contributes the entry, and hands an agent the selection", async () => {
    const server = await startTestServer({ appVersion: APP_VERSION });
    try {
      const { host } = seedHostSession(server.deps);
      seedPrimaryHost(server.deps, host.id);
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
        path: "/tmp/explain-selection-hero-source",
      });
      server.pluginService.bindSdk({ baseUrl: server.baseUrl });

      const entry = await server.pluginService.installPath(
        join(EXAMPLES_DIR, "explain-selection"),
      );
      expect(entry.id).toBe("explain-selection");
      // Unconfigured it contributes no entry at all. A context-menu item is
      // declared rather than asked for at click time, so one that cannot work
      // would sit in the menu doing nothing when clicked.
      expect(entry.status).toBe("needs-configuration");
      expect(entry.statusDetail).toContain(
        "patcher plugin config explain-selection",
      );
      expect(server.pluginService.listContextMenuItemContributions()).toEqual(
        [],
      );

      // Configure (as `patcher plugin config explain-selection set ...` would) and
      // reload: the page's context menu gains an entry, with no browser-core
      // change and no restart.
      await server.pluginService.updateSettings("explain-selection", {
        project: project.id,
      });
      await server.pluginService.reload("explain-selection");
      expect(
        server.pluginService.list().find((p) => p.id === "explain-selection")
          ?.status,
      ).toBe("running");
      expect(server.pluginService.listContextMenuItemContributions()).toEqual([
        {
          pluginId: "explain-selection",
          itemId: "explain",
          title: "Explain with Agent",
          // Normalized by the host, so the shell reads every key rather than
          // treating an absent one as unknown.
          when: { image: false, link: false, page: false, selection: true },
        },
      ]);

      // The user selects text and picks the entry. Only the click travels back:
      // the shell composed the menu from the declared list above.
      const selection = "Retries must be idempotent.";
      const picked = await fetch(
        `${server.baseUrl}/api/v1/plugins/browser/context-menu`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            pluginId: "explain-selection",
            itemId: "explain",
            tabId: "tab-1",
            pageUrl: "https://example.test/spec",
            linkUrl: null,
            imageUrl: null,
            selectionText: selection,
          }),
        },
      );
      expect(picked.status).toBe(200);
      expect(await picked.json()).toEqual({ ok: true });

      // One thread, attributed to the plugin, titled from the selection.
      const listResponse = await fetch(
        `${server.baseUrl}/api/v1/threads?originPluginId=explain-selection`,
      );
      expect(listResponse.status).toBe(200);
      const threads = (await listResponse.json()) as Array<{
        id: string;
        title: string | null;
      }>;
      expect(threads).toHaveLength(1);
      const threadId = threads[0]?.id ?? "";
      expect(getThread(server.db, threadId)?.originPluginId).toBe(
        "explain-selection",
      );
      expect(threads[0]?.title).toBe("Explain: Retries must be idempotent.");

      // …and the agent received the selected text, as quoted content behind the
      // prompt's marker rather than as instructions.
      const timelineResponse = await fetch(
        `${server.baseUrl}/api/v1/threads/${threadId}/timeline`,
      );
      expect(timelineResponse.status).toBe(200);
      const timeline = threadTimelineResponseSchema.parse(
        await timelineResponse.json(),
      );
      const userRow = timeline.rows.find(
        (row) => row.kind === "conversation" && row.role === "user",
      );
      if (
        !userRow ||
        userRow.kind !== "conversation" ||
        userRow.role !== "user"
      ) {
        throw new Error("Expected user conversation timeline row");
      }
      expect(userRow.text).toContain("--- quoted page content follows ---");
      expect(userRow.text.indexOf(selection)).toBeGreaterThan(
        userRow.text.indexOf("--- quoted page content follows ---"),
      );

      // No desktop app is connected, so the plugin's tab-open could not run —
      // and the explanation still happened. A courtesy that fails is not a
      // failed menu action.
      const listedPlugin = server.pluginService
        .list()
        .find((p) => p.id === "explain-selection");
      expect(listedPlugin?.handlerStats.errorCount).toBe(0);
    } finally {
      await server.pluginService.stop();
      await server.close();
    }
  });
});
