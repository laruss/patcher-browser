/**
 * What the host believes about a plugin process's registrations.
 *
 * The permission gate has two halves. What a plugin **calls** crosses the pipe
 * and is charged on this side (./plugin-host-call-server.ts). What a plugin
 * **registers** does not cross as calls at all: the factory runs in the
 * plugin's own process, `createPluginApi` builds the records there, and the
 * host learns them from one bootstrap reply. That reply used to be adopted with
 * an `as unknown as` cast — no parse, and no comparison against the very
 * `permissions` and `sites` the host had just sent in the same payload. So the
 * half of the model `patcher.sites` guards was enforced by a copy of the rule
 * running inside the process it was meant to bind, and a plugin that wrote to
 * the channel itself never met it: a manifest declaring nothing could report a
 * page script whose pattern matches every scheme and every host, and the app
 * would run it on every page the user visits.
 *
 * This module is the host's own answer to the same questions, asked of the
 * reply rather than of the call:
 *
 * 1. is it shaped like a registration snapshot at all (zod, not a cast);
 * 2. does anything in it cost a permission the plugin did not declare;
 * 3. does every page contribution's `matches` name a site the manifest
 *    declared, by the one rule in ./plugin-declared-sites.ts.
 *
 * Reaching a refusal means the two sides disagree — the child's own copy would
 * have thrown at the call site — so, like `chargeBrowserCommand`, a refusal is
 * worth a line in the log: this is the only place either one is visible.
 *
 * The child-side copy stays where it is. It is what gives an under-declared
 * plugin's author, or an agent writing one, a fixable error naming the
 * permission and the line to add.
 */

import { z } from "zod";
import { appKeybindingOverridesSchema } from "@patcher/domain/app-keybindings";
import { BROWSER_PAGE_SCRIPT_MAX_MATCHES } from "@patcher/domain/browser-page-script";
import { BROWSER_PAGE_STYLE_MAX_MATCHES } from "@patcher/domain/browser-page-style";
import { normalizeBrowserSearchEngineTemplate } from "@patcher/domain/browser-search-engine";
import type { PluginPermission } from "@patcher/domain/plugin-permissions";
import { resolveDeclaredMatches } from "./plugin-declared-sites.js";
import { createPluginPermissionGate } from "./plugin-permission-gate.js";
import {
  PLUGIN_SETTING_KEY_PATTERN,
  pluginSettingDescriptorSchema,
} from "./plugin-setting-descriptors.js";
import type { PluginRegistrationSnapshot } from "./plugin-child-runtime.js";

/**
 * A bootstrap reply the host would not adopt.
 *
 * Its own class because the loader has to tell it apart from every other way a
 * plugin process fails: those fall back to running the plugin in the server,
 * and this one must not (see `loadOutOfProcess` in ./plugin-runtime.ts).
 */
export class PluginRegistrationRefusedError extends Error {
  readonly pluginId: string;

  constructor(pluginId: string, problem: string) {
    super(
      `plugin "${pluginId}" reported registrations its declaration does not ` +
        `cover: ${problem}`,
    );
    this.name = "PluginRegistrationRefusedError";
    this.pluginId = pluginId;
  }
}

/**
 * A bound rather than a budget. The anonymous registrations carry a count and
 * nothing else — the host builds that many callbacks whose index is their
 * identity — so a reply saying `2 ** 30` is an allocation, not a plugin.
 */
const MAX_ANONYMOUS_HANDLERS = 256;

const handlerCount = z.number().int().min(0).max(MAX_ANONYMOUS_HANDLERS);
const identified = { id: z.string(), label: z.string() };
const titled = { id: z.string(), title: z.string() };

/**
 * The snapshot, as data.
 *
 * Every field is here because the point is to stop casting: a missing one is a
 * field the host would still be taking on trust. Extra keys are dropped rather
 * than refused (zod's default) — the two sides ship together, so an unknown key
 * is noise, not a reason to leave a plugin unloaded.
 *
 * Values are checked structurally, plus the two rules that decide what reaches
 * a page: a search engine's template (the omnibox navigates to it, so
 * `javascript:` may not be one) and the settings descriptors, by the same
 * schema `patcher.settings.define` is held to.
 */
const snapshotSchema = z.object({
  httpRoutes: z.array(
    z.object({
      method: z.string(),
      path: z.string(),
      auth: z.enum(["local", "token", "none"]),
    }),
  ),
  rpcMethods: z.array(z.string()),
  backgroundServices: z.array(z.string()),
  schedules: z.array(z.object({ name: z.string(), cron: z.string() })),
  cli: z
    .object({
      name: z.string(),
      summary: z.string(),
      commands: z.array(
        z.object({
          name: z.string(),
          summary: z.string(),
          usage: z.string(),
        }),
      ),
    })
    .nullable(),
  agentTools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      instructions: z.string().nullable(),
      // The JSON Schema the model is shown: arbitrary by contract, and the
      // agent side is what decides whether it can use it.
      inputSchema: z.unknown(),
      experimentalStatusLabels: z
        .object({ pending: z.string(), completed: z.string() })
        .nullable(),
    }),
  ),
  hasAgentConfiguration: z.boolean(),
  hasInstructionProvider: z.boolean(),
  mentionProviders: z.array(
    z.object({
      ...identified,
      triggers: z.array(z.enum(["@", "#", "$", "!", "~"])),
    }),
  ),
  omniboxProviders: z.array(z.object({ ...identified, hasRun: z.boolean() })),
  contextMenuItems: z.array(
    z.object({
      ...titled,
      when: z.object({
        image: z.boolean(),
        link: z.boolean(),
        page: z.boolean(),
        selection: z.boolean(),
      }),
    }),
  ),
  findActions: z.array(z.object(titled)),
  tabActions: z.array(z.object(titled)),
  siteInfoProviders: z.array(z.object(identified)),
  toolbarItems: z.array(
    z.object({
      ...titled,
      icon: z.string().nullable(),
      hasState: z.boolean(),
    }),
  ),
  newTabWidgets: z.array(z.object(identified)),
  commands: z.array(
    z.object({
      ...titled,
      shortcut: z.object({
        key: z.string(),
        alt: z.boolean(),
        control: z.boolean(),
        meta: z.boolean(),
        mod: z.boolean(),
        shift: z.boolean(),
      }),
    }),
  ),
  downloadHandlerCount: handlerCount,
  historyFilterCount: handlerCount,
  authProviderCount: handlerCount,
  pdfTextProviderCount: handlerCount,
  externalLinkHandlerCount: handlerCount,
  keybindings: appKeybindingOverridesSchema,
  searchEngines: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      urlTemplate: z
        .string()
        .refine(
          (template) => normalizeBrowserSearchEngineTemplate(template) !== null,
          "must be an https (or loopback) url containing the query placeholder",
        ),
    }),
  ),
  // `matches` is a list of strings here and a member of the declared sites
  // below: membership is not a shape, and its refusal names the list.
  pageStyles: z.array(
    z.object({ id: z.string(), matches: z.array(z.string()), css: z.string() }),
  ),
  pageScripts: z.array(
    z.object({
      id: z.string(),
      matches: z.array(z.string()),
      code: z.string(),
    }),
  ),
  threadEvents: z.array(z.string()),
  // The key as well as the descriptor: a secret's key becomes a file name, so
  // a reported key is a path this process would write.
  settingsDescriptors: z.record(
    z.string().regex(PLUGIN_SETTING_KEY_PATTERN),
    pluginSettingDescriptorSchema(),
  ),
  hasSettingsListeners: z.boolean(),
});

/**
 * The schema and the interface, checked against each other in both directions.
 *
 * This is the guard's own guard: a field added to `PluginRegistrationSnapshot`
 * fails to compile here instead of quietly arriving unvalidated, which is the
 * exact shape of the bug this module exists for.
 */
type Assert<T extends true> = T;
type SchemaShape = z.infer<typeof snapshotSchema>;
export type _SchemaCoversSnapshot = Assert<
  SchemaShape extends PluginRegistrationSnapshot ? true : false
>;
export type _SnapshotCoversSchema = Assert<
  PluginRegistrationSnapshot extends SchemaShape ? true : false
>;

/**
 * Which reported registrations cost a permission, and what the plugin's own
 * vocabulary calls them.
 *
 * The child charges these one `permissionGate.assert` at a time inside each
 * `register*` (plugin-api.ts); the host has only the snapshot, so the same
 * decision is a table over its fields. The strings are the ones the child
 * passes, so the refusal in the server's log and the error in the plugin's own
 * process read as the same sentence.
 *
 * A field absent from this table is a registration no permission gates —
 * mentions, commands, http routes, rpc, schedules, cli, agent tools. Adding one
 * here that the child does not charge would refuse a plugin the install told
 * nothing about, so this table follows plugin-api.ts rather than leading it.
 */
const REGISTRATION_PERMISSIONS = {
  omniboxProviders: [
    "omnibox.register",
    "patcher.browser.registerOmniboxProvider",
  ],
  contextMenuItems: [
    "contextMenu.register",
    "patcher.browser.registerContextMenuItem",
  ],
  findActions: ["find.register", "patcher.browser.registerFindAction"],
  tabActions: ["tabMenu.register", "patcher.browser.registerTabAction"],
  siteInfoProviders: [
    "siteInfo.register",
    "patcher.browser.registerSiteInfoProvider",
  ],
  toolbarItems: ["toolbar.register", "patcher.browser.registerToolbarItem"],
  newTabWidgets: ["newTab.register", "patcher.browser.registerNewTabWidget"],
  searchEngines: [
    "searchEngine.register",
    "patcher.browser.registerSearchEngine",
  ],
  pageStyles: ["pageStyle.register", "patcher.browser.registerPageStyle"],
  pageScripts: ["pageScript.register", "patcher.browser.registerPageScript"],
  authProviderCount: ["auth.provide", "patcher.browser.registerAuthProvider"],
  pdfTextProviderCount: [
    "pdf.provide",
    "patcher.browser.registerPdfTextProvider",
  ],
  externalLinkHandlerCount: [
    "externalLink.handle",
    "patcher.browser.registerExternalLinkHandler",
  ],
  historyFilterCount: ["history", "patcher.browser.registerHistoryFilter"],
  downloadHandlerCount: [
    "downloads.handle",
    "patcher.browser.registerDownloadHandler",
  ],
  threadEvents: ["threads", "patcher.events.on"],
} satisfies Partial<
  Record<keyof PluginRegistrationSnapshot, readonly [PluginPermission, string]>
>;

/**
 * `Object.entries` with the keys kept, so `snapshot[field]` typechecks against
 * the interface rather than through an index signature it does not have.
 */
function typedEntries<K extends string, V>(table: Record<K, V>): Array<[K, V]> {
  return Object.entries(table) as Array<[K, V]>;
}

/** Whether the snapshot claims any registration of this kind. */
function claimed(value: unknown): boolean {
  return typeof value === "number"
    ? value > 0
    : Array.isArray(value) && value.length > 0;
}

/** First issue only: the log wants the reason, not the whole parse tree. */
function summarizeIssues(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return "invalid";
  const path = issue.path.join(".");
  return `${path.length > 0 ? path : "(root)"}: ${issue.message}`;
}

/**
 * Parse one bootstrap reply and charge what it claims, or refuse it.
 *
 * Returns the snapshot the host will hold — the parsed value, so everything
 * downstream reads the checked shape rather than the reply.
 */
export function adoptPluginRegistrationSnapshot(args: {
  pluginId: string;
  permissions: readonly PluginPermission[] | undefined;
  sites: readonly string[] | undefined;
  reply: unknown;
  logger?: { warn(message: string): void };
}): PluginRegistrationSnapshot {
  const refuse = (problem: string): never => {
    const error = new PluginRegistrationRefusedError(args.pluginId, problem);
    // Said out loud rather than only thrown: a refusal here means the host and
    // the plugin's own copy of the gate disagree, which is either a bug in the
    // pair or a plugin writing to the channel itself.
    args.logger?.warn(`${error.message}; not loaded`);
    throw error;
  };

  const parsed = snapshotSchema.safeParse(args.reply);
  if (!parsed.success) {
    return refuse(
      `its bootstrap reply is not a registration snapshot (${summarizeIssues(parsed.error)})`,
    );
  }
  const snapshot: PluginRegistrationSnapshot = parsed.data;
  const gate = createPluginPermissionGate(args.pluginId, args.permissions);
  const declared = args.sites ?? [];

  try {
    for (const [field, [permission, what]] of typedEntries(
      REGISTRATION_PERMISSIONS,
    )) {
      if (!claimed(snapshot[field])) continue;
      gate.assert(permission, what);
    }
    for (const style of snapshot.pageStyles) {
      resolveDeclaredMatches({
        kind: "page style",
        id: style.id,
        matches: style.matches,
        maxMatches: BROWSER_PAGE_STYLE_MAX_MATCHES,
        declared,
        pluginId: args.pluginId,
      });
    }
    for (const script of snapshot.pageScripts) {
      resolveDeclaredMatches({
        kind: "page script",
        id: script.id,
        matches: script.matches,
        maxMatches: BROWSER_PAGE_SCRIPT_MAX_MATCHES,
        declared,
        pluginId: args.pluginId,
      });
    }
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error));
  }

  return snapshot;
}
