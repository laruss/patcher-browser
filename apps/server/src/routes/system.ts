import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { formatCustomAcpAgentProviderId } from "@patcher/config/patcher-app-managed-config";
import {
  createBrowserAccessGrant,
  getAppSettings,
  getAppKeybindingOverrides,
  getExperiments,
  getStoredFaviconColor,
  getStoredThemeId,
  hasActiveThreadAttention,
  listBrowserAccessGrants,
  pauseBrowserAccessGrant,
  resumeBrowserAccessGrant,
  revokeBrowserAccessGrant,
  setAppSettings,
  setAppKeybindingOverrides,
  setExperiments,
  setStoredAppearance,
} from "@patcher/db";
import { deriveAgentAccessKey } from "@patcher/config/agent-access-key";
import {
  applyAppKeybindingOverrides,
  applyPluginAppKeybindings,
  BROWSER_EXTERNAL_ACCESS_DESCRIPTIONS,
  customThemeNameSchema,
  isBuiltInThemeId,
  permissionsForBrowserExternalAccess,
  type AppKeybindingOverrides,
  type AppTheme,
} from "@patcher/domain";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@patcher/server-contract";
import type { Hono } from "hono";
import type { ServerAppDeps, ServerRuntimeConfig } from "../types.js";
import type { PluginService } from "../services/plugins/plugin-service.js";
import { ApiError } from "../errors.js";
import {
  resolveVoiceTranscriptionEnabled,
  transcribeVoiceInput,
} from "../services/ai/voice-transcription.js";
import {
  listSystemProviderInfos,
  resolveSystemExecutionOptions,
} from "../services/system/execution-options.js";
import {
  getOnboardingAgentOverview,
  getOnboardingRepos,
  recordOnboardingEvent,
} from "../services/system/onboarding.js";
import { getProviderUsageLimits } from "../services/system/usage-limits.js";
import {
  listCustomThemeNames,
  readCustomThemeCss,
  resolveAppTheme,
  resolveCustomThemeCssPath,
  resolveThemeRootPath,
} from "../services/system/custom-themes.js";
import { schedulePrimaryHostCaffeinateReconciliation } from "../services/system/app-settings.js";
import {
  installGlobalCliSkills,
  listInstallableMachineIds,
  readGlobalCliSkillStatus,
} from "../services/skills/global-skill-install.js";
import { DEFAULT_APP_KEYBINDINGS } from "../services/system/app-keybindings.js";
import { declaresThread, requirePluginConsent } from "./plugin-consent.js";
import { resolvePrimaryHostId } from "../services/hosts/primary-host.js";
// The plugin that serves `patcher browser`. Turned on by the browser access
// route, because a level that lets an outside agent drive the browser with
// nothing registered to serve the command is a setting that silently does
// nothing. Defined beside the gate rather than here — the route policy for a
// grant names the same plugin.
import { BROWSER_TOOLS_PLUGIN_ID } from "../services/browser/browser-external-access.js";

/**
 * Whether `patcher browser` would actually answer.
 *
 * The registered CLI command, not the persisted `enabled` bit. A plugin can be
 * enabled in storage and still be `missing`, `incompatible` or `error` —
 * `loadOne` records most load failures rather than throwing — and reporting
 * such a plugin as enabled tells the CLI to suppress the very warning that
 * would explain why `patcher browser` does nothing. The contribution is the
 * thing the caller is about to use, so it is the thing to ask about.
 */
function isBrowserToolsServing(pluginService: PluginService): boolean {
  return pluginService
    .list()
    .some(
      (plugin) =>
        plugin.id === BROWSER_TOOLS_PLUGIN_ID &&
        plugin.enabled &&
        plugin.cliCommand !== null,
    );
}

const CUSTOM_ACP_LOGO_CONTENT_TYPES = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
} as const;

interface SystemConfigRequest {
  url: string;
  header(name: string): string | undefined;
}

function firstForwardedValue(value: string | undefined): string | undefined {
  return value?.split(",", 1)[0]?.trim() || undefined;
}

function effectivePort(url: URL): number | null {
  if (url.port.length > 0) return Number(url.port);
  if (url.protocol === "http:") return 80;
  if (url.protocol === "https:") return 443;
  return null;
}

function resolveSystemServerUrl(
  request: SystemConfigRequest,
  config: Pick<
    ServerRuntimeConfig,
    "appUrl" | "devAppPort" | "isDevelopment" | "serverPort"
  >,
): string {
  if (config.appUrl !== undefined) return config.appUrl.replace(/\/+$/u, "");

  const requestUrl = new URL(request.url);
  const forwardedHost = firstForwardedValue(request.header("x-forwarded-host"));
  if (forwardedHost === undefined) return requestUrl.origin;

  const forwardedProtocol =
    firstForwardedValue(request.header("x-forwarded-proto")) ??
    requestUrl.protocol.replace(/:$/u, "");
  const forwardedUrl = new URL(`${forwardedProtocol}://${forwardedHost}`);
  if (
    config.isDevelopment &&
    config.devAppPort !== undefined &&
    effectivePort(forwardedUrl) === config.devAppPort
  ) {
    forwardedUrl.port = String(config.serverPort);
  }
  return forwardedUrl.origin;
}

export function registerSystemRoutes(
  app: Hono,
  deps: ServerAppDeps,
  pluginService: PluginService,
): void {
  const { del, get, post, put } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.system;

  const themeRoot = resolveThemeRootPath(deps.config.dataDir);

  get(routes.attention, (context) =>
    context.json({ hasAttention: hasActiveThreadAttention(deps.db) }),
  );

  function readAppKeybindingOverrides(): AppKeybindingOverrides {
    try {
      return getAppKeybindingOverrides(deps.db);
    } catch (error) {
      deps.logger.error(
        { err: error },
        "Stored keyboard shortcut overrides are invalid; using defaults",
      );
      return [];
    }
  }

  async function resolveSelectedTheme(
    themeId: string,
    faviconColor: AppTheme["faviconColor"],
  ): Promise<AppTheme> {
    const pluginCss = await pluginService.readThemeCss(themeId);
    if (pluginCss !== null)
      return { themeId, customCss: pluginCss, faviconColor };
    return resolveAppTheme(themeRoot, themeId, faviconColor);
  }

  async function buildSystemConfigResponse(serverUrl: string) {
    const keybindingOverrides = readAppKeybindingOverrides();
    // Plugins decide what this install's *defaults* are; the user's overrides
    // still sit on top. Folding them into the defaults rather than into the
    // overrides is what keeps the settings UI honest about which shortcuts the
    // user has actually changed.
    const defaultKeybindings = applyPluginAppKeybindings(
      DEFAULT_APP_KEYBINDINGS,
      pluginService.listKeybindingContributions(),
    );
    const primaryHostId = resolvePrimaryHostId(deps);
    return {
      generalSettings: getAppSettings(deps.db),
      keybindings: applyAppKeybindingOverrides(
        defaultKeybindings,
        keybindingOverrides,
      ),
      defaultKeybindings,
      keybindingOverrides,
      experiments: getExperiments(deps.db),
      appearance: await resolveSelectedTheme(
        getStoredThemeId(deps.db),
        getStoredFaviconColor(deps.db),
      ),
      customThemes: listCustomThemeNames(themeRoot),
      pluginThemes: pluginService.listThemes(),
      featureFlags: deps.config.featureFlags,
      hostDaemonPort: deps.config.hostDaemonPort,
      serverUrl,
      primaryHostId,
      primaryHostPlatform:
        primaryHostId === null
          ? null
          : deps.hub.getDaemonPlatformForHost(primaryHostId),
      voiceTranscriptionEnabled: resolveVoiceTranscriptionEnabled(deps),
      dataDir: deps.config.dataDir,
    };
  }

  get(routes.config, async (context) => {
    const serverUrl = resolveSystemServerUrl(context.req, deps.config);
    return context.json(await buildSystemConfigResponse(serverUrl));
  });

  put(routes.generalSettings, (context, payload) => {
    // The browser level is not this route's to write, even though it rides in
    // the same object. Two reasons, and the first is the one that bites: this
    // handler persists the payload wholesale, and the settings page holds its
    // own copy — so toggling any other option while the browser mutation was
    // still in flight would send a stale level and silently put it back. The
    // second is that the dedicated route does more than write (it enables the
    // plugin) and asks more than this one (it raises a prompt inside a turn),
    // so a write that arrives here has been through neither.
    setAppSettings(deps.db, {
      ...payload,
      browserExternalAccess: getAppSettings(deps.db).browserExternalAccess,
    });
    deps.hub.notifySystem(["config-changed"]);
    schedulePrimaryHostCaffeinateReconciliation(deps, {
      reason: "settings-updated",
    });
    return context.json(getAppSettings(deps.db));
  });

  /**
   * How far agents outside Patcher may drive the browser.
   *
   * Its own route rather than a field on `PUT /settings/general`, and the
   * reason is who may ask. Every route under `/settings` is refused to a turn
   * (`agent-route-policy.ts`), deliberately, so the next setting is closed on
   * arrival — and the thing an agent inside Patcher legitimately wants here is
   * to *ask*, which needs a prompt rather than a write. So this route carries
   * the same consent gate a plugin change carries: no thread declared is a
   * person at their own terminal or the app's own control, and behaves as
   * those always have; a declared thread raises a prompt naming the level and
   * what it allows, and writes nothing unless the user says yes.
   *
   * **It enables `browser-tools` only when nobody is being asked**, and that
   * asymmetry is the whole of what review found wrong with the first version.
   * A level without the plugin is a setting that does nothing, so the person
   * choosing a level in Settings — or at their own terminal — plainly means
   * both, and gets both. A *turn* asking is a different question with a
   * different beneficiary: the prompt describes what agents outside Patcher may
   * do and says in as many words that this thread is unaffected, while enabling
   * the plugin hands **that thread** everything the plugin declares, cookies and
   * recording and interception included. Measured on 2026-09-05: a turn refused
   * `cookie-list` before the prompt could run it after, having asked for
   * "Read pages". So a turn's approval writes the level and stops; the reply
   * says the plugin is not serving, and `patcher plugin enable browser-tools`
   * is the honest second question, with a prompt that lists what it really
   * grants.
   *
   * Turning external access off leaves the plugin alone either way, since
   * threads inside Patcher use it too and nobody asked about those.
   */
  post(routes.browserExternalAccess, async (context, payload) => {
    const { level } = payload;
    const allowed = permissionsForBrowserExternalAccess(level);
    const consent = await requirePluginConsent({
      action: "browser-external-access",
      context,
      deps,
      subjectId: level,
      subjectName: BROWSER_EXTERNAL_ACCESS_DESCRIPTIONS[level].label,
      permissions: allowed,
      detail: BROWSER_EXTERNAL_ACCESS_DESCRIPTIONS[level].detail,
    });
    if (!consent.allowed) {
      throw new ApiError(consent.status, "forbidden", consent.error);
    }
    // The plugin first, then the level, and the order is chosen for which
    // half-done state is survivable rather than for atomicity — these are two
    // stores and this route is not a transaction. Enable-then-write leaves, on
    // a failure, a plugin that is on with the level unchanged: nothing an agent
    // outside Patcher gained, and the plugin toggle is the gate threads already
    // had. Write-then-enable would leave the opposite — a level with nothing
    // serving it — which reads to a caller as a feature that is on and broken.
    // The reply says which of the two actually happened rather than assuming.
    let browserToolsEnabled = isBrowserToolsServing(pluginService);
    if (level !== "off" && !browserToolsEnabled && !declaresThread(context)) {
      await pluginService.setEnabled(BROWSER_TOOLS_PLUGIN_ID, true);
      browserToolsEnabled = isBrowserToolsServing(pluginService);
    }
    setAppSettings(deps.db, {
      ...getAppSettings(deps.db),
      browserExternalAccess: level,
    });
    deps.hub.notifySystem(["config-changed"]);
    return context.json({ level, browserToolsEnabled });
  });

  /**
   * The grants that are open to an agent outside Patcher, and the credential
   * for a new one.
   *
   * **Why this route is closed to a turn, when the level route beside it is
   * not.** The level route answers "may agents outside Patcher drive the
   * browser", and a turn asking that raises a prompt because the answer is
   * about *other* agents and costs the asking thread nothing. This route
   * answers with a credential, and a credential is not a setting: a thread key
   * stops working when the turn ends, and a grant does not stop until a person
   * revokes it. So a turn that could call this would have minted itself a
   * browser credential that outlives its own — the escalation dressed as a
   * question. `agent-route-policy.ts` refuses the mutation for that reason;
   * reading the list stays open, since a list carries no credentials.
   *
   * And a grant holder cannot reach it either, which is the other half:
   * `agent-access-route-policy.ts` admits two routes and this is not one, so a
   * grant cannot widen itself or mint a second one.
   *
   * It enables `browser-tools` for the same reason the level route does when
   * nobody is being asked — a credential for a command nothing serves is a
   * credential that silently does nothing — and there is no asked case here,
   * because the only callers are the app and a person's own terminal.
   */
  get(routes.browserAccessGrants, (context) =>
    context.json({ grants: listBrowserAccessGrants(deps.db) }),
  );

  post(routes.createBrowserAccessGrant, async (context, payload) => {
    if (!isBrowserToolsServing(pluginService)) {
      await pluginService.setEnabled(BROWSER_TOOLS_PLUGIN_ID, true);
    }
    const grant = createBrowserAccessGrant(deps.db, {
      label: payload.label,
      level: payload.level,
    });
    deps.hub.notifySystem(["config-changed"]);
    return context.json({
      grant,
      // Derived, never stored: the row is the grant and this is a function of
      // it. See `agent-access-key.ts`.
      key: deriveAgentAccessKey({
        appApiKey: deps.appApiKey,
        grantId: grant.id,
      }),
      browserToolsEnabled: isBrowserToolsServing(pluginService),
    });
  });

  put(routes.setBrowserAccessGrantPaused, (context, payload) => {
    const id = context.req.param("id");
    const grant = payload.paused
      ? pauseBrowserAccessGrant(deps.db, id)
      : resumeBrowserAccessGrant(deps.db, id);
    if (grant === undefined) {
      throw new ApiError(
        404,
        "not_found",
        `No browser access grant '${id}'. Nothing changed — check \`patcher agent-access list\`.`,
      );
    }
    // A revoked grant cannot be paused or resumed, and answering 200 with a row
    // that ignored the request would be the kind of success nobody can act on.
    if (grant.revokedAt !== null) {
      throw new ApiError(
        409,
        "conflict",
        `Browser access grant '${id}' was revoked, and revoking has no undo. Issue a new one with \`patcher agent-access grant\`.`,
      );
    }
    deps.hub.notifySystem(["config-changed"]);
    return context.json({ grants: listBrowserAccessGrants(deps.db) });
  });

  del(routes.revokeBrowserAccessGrant, (context) => {
    const id = context.req.param("id");
    if (revokeBrowserAccessGrant(deps.db, id) === undefined) {
      throw new ApiError(
        404,
        "not_found",
        `No browser access grant '${id}'. Nothing was revoked — check \`patcher agent-access list\`.`,
      );
    }
    deps.hub.notifySystem(["config-changed"]);
    // The whole list back, because the one thing a caller does after revoking
    // is look at what is left, and a revoke that answered `{ ok: true }` would
    // make that a second request in every client.
    return context.json({ grants: listBrowserAccessGrants(deps.db) });
  });

  put(routes.keyboardSettings, (context, payload) => {
    setAppKeybindingOverrides(deps.db, payload);
    deps.hub.notifySystem(["config-changed"]);
    return context.json(getAppKeybindingOverrides(deps.db));
  });

  put(routes.experiments, (context, payload) => {
    setExperiments(deps.db, payload);
    // The same kind a config reload broadcasts: every window re-reads
    // /system/config and re-gates its experiment-flagged surfaces.
    deps.hub.notifySystem(["config-changed"]);
    return context.json(getExperiments(deps.db));
  });

  put(routes.appearance, async (context, payload) => {
    const { themeId } = payload;
    const pluginCss = await pluginService.readThemeCss(themeId);
    if (!isBuiltInThemeId(themeId) && pluginCss === null) {
      if (!customThemeNameSchema.safeParse(themeId).success) {
        throw new ApiError(
          400,
          "invalid_request",
          `Invalid theme id '${themeId}'.`,
        );
      }
      if (readCustomThemeCss(themeRoot, themeId) === null) {
        throw new ApiError(
          404,
          "theme_not_found",
          `Custom theme '${themeId}' not found. Create ${resolveCustomThemeCssPath(themeRoot, themeId)} first.`,
        );
      }
    }
    const { faviconColor } = payload;
    setStoredAppearance(deps.db, { themeId, faviconColor });
    // Broadcast like experiments: every window re-reads /system/config and
    // re-applies the active palette.
    deps.hub.notifySystem(["config-changed"]);
    return context.json(
      pluginCss === null
        ? resolveAppTheme(themeRoot, themeId, faviconColor)
        : { themeId, customCss: pluginCss, faviconColor },
    );
  });

  get(routes.themes, async (context) =>
    context.json({
      dir: themeRoot,
      custom: listCustomThemeNames(themeRoot),
      plugins: pluginService.listThemes(),
      active: await resolveSelectedTheme(
        getStoredThemeId(deps.db),
        getStoredFaviconColor(deps.db),
      ),
    }),
  );

  post(routes.reloadConfig, async (context) => {
    try {
      await deps.patcherAppManagedConfig.reload({ notify: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ApiError(422, "invalid_config", message);
    }
    return context.json({ ok: true });
  });

  get(routes.cliSkillsStatus, async (context, query) =>
    context.json(
      await readGlobalCliSkillStatus(deps, {
        hostIds:
          query.hostIds === undefined
            ? listInstallableMachineIds(deps)
            : query.hostIds.split(",").filter((hostId) => hostId.length > 0),
      }),
    ),
  );

  post(routes.installCliSkills, async (context, body) =>
    context.json(await installGlobalCliSkills(deps, { hostIds: body.hostIds })),
  );

  get(routes.providers, async (context, query) =>
    context.json(await listSystemProviderInfos(deps, query)),
  );

  get(routes.providerLogo, async (context) => {
    const providerId = context.req.param("id");
    const agent = deps.config.customAcpAgents.find(
      (candidate) =>
        formatCustomAcpAgentProviderId(candidate.id) === providerId,
    );
    if (agent?.logo === undefined) {
      throw new ApiError(
        404,
        "provider_logo_not_found",
        `Provider '${providerId}' has no configured logo.`,
      );
    }

    const extension = extname(agent.logo).toLowerCase();
    const contentType =
      CUSTOM_ACP_LOGO_CONTENT_TYPES[
        extension as keyof typeof CUSTOM_ACP_LOGO_CONTENT_TYPES
      ];
    if (contentType === undefined) {
      throw new ApiError(
        415,
        "unsupported_provider_logo",
        `Provider '${providerId}' has an unsupported logo format.`,
      );
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(resolve(deps.config.dataDir, agent.logo));
    } catch {
      throw new ApiError(
        404,
        "provider_logo_not_found",
        `Provider '${providerId}' logo file was not found.`,
      );
    }
    return context.body(new Uint8Array(bytes), 200, {
      "cache-control": "no-store",
      "content-type": contentType,
      "x-content-type-options": "nosniff",
    });
  });

  post(routes.onboardingEvent, async (context, body) => {
    recordOnboardingEvent(deps, body);
    return context.json({ ok: true } as const);
  });

  get(routes.onboardingAgents, async (context, query) =>
    context.json(await getOnboardingAgentOverview(deps, query)),
  );

  get(routes.onboardingRepos, async (context, query) =>
    context.json(await getOnboardingRepos(deps, query)),
  );

  get(routes.usageLimits, async (context, query) =>
    context.json(await getProviderUsageLimits(deps, query)),
  );

  get(routes.executionOptions, async (context, query) =>
    context.json(await resolveSystemExecutionOptions(deps, query)),
  );

  post(routes.voiceTranscription, async (context) => {
    const formData = await context.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(400, "invalid_request", "Audio file is required");
    }
    return context.json({
      text: await transcribeVoiceInput(deps, {
        file,
        prompt:
          typeof formData.get("prompt") === "string"
            ? String(formData.get("prompt"))
            : undefined,
      }),
    });
  });

  get(routes.version, async (context, query) =>
    context.json(
      await deps.appVersion.getSystemVersion({
        forceRefresh: query.force === "true",
      }),
    ),
  );
}
