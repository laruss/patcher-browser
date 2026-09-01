import { z } from "zod";
import { DEFAULT_BROWSER_SEARCH_ENGINE_ID } from "./browser-search-engine.js";

/**
 * A hostname as the egress boundary can actually use it.
 *
 * `CONNECT` names a host, so a host is the only unit the proxy can decide on —
 * and somebody adding `https://github.com/org` to a list means `github.com` by
 * it. Stored normalized rather than rejected, because the alternative is an
 * entry that looks right in the settings field and matches nothing at all,
 * which is the silent failure this whole boundary exists to remove. A leading
 * `*.` survives: it is the wildcard, not part of the name.
 */
function normalizeEgressHost(value: string): string {
  const withoutScheme = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//u, "");
  const withoutPath = withoutScheme.split("/")[0] ?? "";
  // A port, but not the colons of an IPv6 literal, which nobody lists by hand.
  return withoutPath.replace(/:\d+$/u, "");
}

/** Hostnames a confined turn may reach, as stored and as sent over the API. */
export const providerEgressAllowedHostsSchema = z
  .array(z.string())
  .transform((hosts) =>
    hosts.map(normalizeEgressHost).filter((host) => host !== ""),
  );
export type ProviderEgressAllowedHosts = z.infer<
  typeof providerEgressAllowedHostsSchema
>;

/**
 * App-wide server-backed preferences.
 * Client-local settings stay in the frontend localStorage helpers instead.
 */
export const appSettingsSchema = z
  .object({
    /**
     * macOS-only: keep the machine from idle sleeping while Patcher is running by
     * asking the local host daemon to hold a caffeinate assertion.
     */
    caffeinate: z.boolean(),
    /** Show shortcut hints after holding Command or Control. */
    showKeyboardHints: z.boolean(),
    /**
     * While a thread is running, make Enter steer the active turn and use
     * Command+Enter to queue a follow-up.
     */
    steerActiveThreadOnEnter: z.boolean(),
    /** Show raw provider events that Patcher does not yet understand. */
    showUnhandledProviderEvents: z.boolean(),
    /** Enable Codex's native memory recall and generation for Patcher threads. */
    codexMemoryEnabled: z.boolean(),
    /** Enable Claude Code's native auto-memory reads and writes for Patcher threads. */
    claudeCodeMemoryEnabled: z.boolean(),
    /** Prevent Codex from exposing its native multi-agent tools to Patcher threads. */
    codexSubagentsDisabled: z.boolean(),
    /** Prevent Claude Code from exposing its native Task tool to Patcher threads. */
    claudeCodeSubagentsDisabled: z.boolean(),
    /** Prevent Claude Code from exposing its native Workflow tool. */
    claudeCodeWorkflowsDisabled: z.boolean(),
    /**
     * Take the network away from a sandboxed Codex turn's own commands.
     *
     * Off by default, and the default is the decision rather than an oversight.
     * Codex turns a blocked connection into an approval request, so the cost is
     * not a silent failure — it is a prompt for every outbound connection a turn
     * makes: `npm install`, `git fetch`, whatever API the work is about. Where
     * nobody is watching, a schedule or a delegated child thread, that prompt
     * times out and the command fails.
     *
     * What it no longer costs is the `patcher` CLI: a turn reaches Patcher
     * through an MCP tool that runs outside the command sandbox, so this setting
     * does not take the agent's own tooling with it. See
     * `codex/mcp-server.ts`.
     *
     * Full Access builds no sandbox, so there is nothing for this to restrict
     * there — it applies to the modes that have a permission profile.
     */
    codexNetworkDisabled: z.boolean(),
    /**
     * Route everything a sandboxed Pi or ACP turn sends off the machine through
     * Patcher's own proxy, and refuse what is not on a list.
     *
     * A different thing from `codexNetworkDisabled`, for a different reason.
     * Codex's sandbox wraps the commands a turn runs, and Codex's own traffic to
     * its model is outside it — so there the network is a switch. For Pi and ACP
     * the sandbox wraps the *provider's own process*, the one that has to reach
     * its model, so an absolute deny would end the turn. What this does instead
     * is make the way out selective: the OS refuses every outbound connection
     * except to the proxy, and the proxy answers by hostname.
     *
     * Off by default, and the cost is why. A host nobody listed is refused
     * rather than asked about, `git push` over an SSH remote stops working
     * (HTTPS remotes keep working), and a provider that has not declared its own
     * hosts is left unconfined rather than cut off from its model. macOS only so
     * far: bubblewrap can only take the network by taking the whole namespace,
     * which takes the loopback the `patcher` CLI needs with it.
     */
    providerEgressConfined: z.boolean(),
    /**
     * Hostnames a confined turn may reach on top of what its provider declared.
     *
     * The provider's declaration covers its own model API and nothing else, so
     * this is where the work's own hosts go: `github.com`, a package registry,
     * whatever the repository actually talks to. `*.example.com` matches
     * subdomains, not the bare name.
     */
    providerEgressAllowedHosts: providerEgressAllowedHostsSchema,
    /**
     * ISO timestamp of when first-run onboarding last finished or was
     * dismissed; null means it has never run. A timestamp rather than a boolean
     * so we also know *when*, and so "never ran" has an honest value.
     *
     * Deliberately not a proxy for "is Patcher set up": whether an agent is usable is
     * answered live by `provider.usage`, so dismissing onboarding never claims
     * the machine is configured. Setting this back to null re-triggers the flow.
     */
    onboardingCompletedAt: z.string().nullable(),
    /**
     * Which search engine the browser's address bar uses, by id — Patcher's own or
     * one a plugin declared (`patcher.browser.registerSearchEngine`).
     *
     * An id rather than the template itself, so removing the plugin that
     * declared it leaves a setting that resolves back to Patcher's default instead of
     * a URL nothing can serve. See `browser-search-engine.ts`.
     */
    browserSearchEngineId: z.string(),
  })
  .strict();
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const defaultAppSettings: AppSettings = {
  caffeinate: false,
  showKeyboardHints: true,
  steerActiveThreadOnEnter: false,
  showUnhandledProviderEvents: false,
  codexMemoryEnabled: true,
  claudeCodeMemoryEnabled: true,
  codexSubagentsDisabled: false,
  claudeCodeSubagentsDisabled: false,
  claudeCodeWorkflowsDisabled: false,
  // The network stays on unless somebody turns it off: see the schema for why.
  codexNetworkDisabled: false,
  providerEgressConfined: false,
  providerEgressAllowedHosts: [],
  onboardingCompletedAt: null,
  browserSearchEngineId: DEFAULT_BROWSER_SEARCH_ENGINE_ID,
};
