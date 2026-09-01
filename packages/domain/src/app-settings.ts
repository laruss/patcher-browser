import { z } from "zod";
import { DEFAULT_BROWSER_SEARCH_ENGINE_ID } from "./browser-search-engine.js";

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
  onboardingCompletedAt: null,
  browserSearchEngineId: DEFAULT_BROWSER_SEARCH_ENGINE_ID,
};
