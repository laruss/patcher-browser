import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type AppKeybindingOverrides,
  type AppSettings,
  type AppThemeSelection,
  type Experiments,
} from "@patcher/domain";
import type {
  SystemBrowserAccessRequestDecideRequest,
  SystemBrowserExternalAccessRequest,
  SystemCliSkillsOfferRequest,
  SystemCliSkillsSetupRequest,
  SystemInstallCliCommandRequest,
  SystemInstallCliSkillsRequest,
} from "@patcher/server-contract";
import { sdk } from "@/lib/sdk";
import {
  reconcileAnsweredBrowserAccessRequest,
  setBrowserAccessGrants,
} from "../cache-owners/browser-access-grant-cache-owner";
import { invalidatePluginList } from "../cache-owners/plugin-cache-owner";
import {
  invalidateCliCommandStatus,
  invalidateCliSkillsStatus,
  invalidateGeneralSettingsDependencies,
  invalidateSystemConfig,
} from "../cache-owners/system-cache-effects";
import {
  beginKeyboardSettingsCacheTransaction,
  rollbackKeyboardSettingsCacheTransaction,
} from "../cache-owners/system-config-cache-owner";

/**
 * Replace the user's opt-in experiments (full object). The server broadcasts
 * system `config-changed` for other windows; the local invalidation gives this
 * window an immediate refresh.
 */
export function useUpdateExperiments() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update experiments.",
    },
    mutationFn: (experiments: Experiments) =>
      sdk.system.updateExperiments(experiments),
    onSuccess: () => {
      invalidateSystemConfig({ queryClient });
    },
  });
}

/**
 * Replace the user's server-backed Settings → General preferences. The server
 * broadcasts `config-changed` for other windows; the local invalidation gives
 * this window an immediate refresh.
 */
export function useUpdateGeneralSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update general settings.",
    },
    mutationFn: (settings: AppSettings) =>
      sdk.system.updateGeneralSettings(settings),
    onSuccess: () => {
      invalidateGeneralSettingsDependencies({ queryClient });
    },
  });
}

/**
 * Set how far agents outside Patcher may drive the browser.
 *
 * Its own route rather than a field on the general settings, so it goes through
 * its own mutation: the server also turns the `browser-tools` plugin on when
 * the level is not `off`, and the plugin list has to be invalidated for the
 * plugins page to show that. Everything else about the settings page reads the
 * system config, which the route's `config-changed` broadcast refreshes.
 */
export function useSetBrowserExternalAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to change browser access for outside agents.",
    },
    mutationFn: (args: SystemBrowserExternalAccessRequest) =>
      sdk.system.setBrowserExternalAccess(args),
    onSuccess: () => {
      invalidateGeneralSettingsDependencies({ queryClient });
      void invalidatePluginList({ queryClient });
    },
  });
}

/**
 * Take back one agent's browser credential.
 *
 * Revoking only. Issuing a grant answers with a credential that has to reach
 * an agent, and `patcher agent-access grant` delivers it in one command — a
 * `0600` file, whose path `--for claude-code` writes into that agent's
 * configuration — so a panel that showed the string instead would be a worse
 * version of the same act. Taking one back
 * is the half that belongs here, because it is the half somebody does in a
 * hurry.
 */
export function useRevokeBrowserAccessGrant() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { errorMessage: "Failed to revoke the browser access grant." },
    mutationFn: (grantId: string) =>
      sdk.system.revokeBrowserAccessGrant(grantId),
    onSuccess: (grants) => {
      setBrowserAccessGrants({ grants, queryClient });
    },
  });
}

/**
 * Stop one agent's browser credential for now, or let it work again.
 *
 * The other half of "stop", and the one the browser chrome's own button uses
 * while an agent is mid-command: the credential stays valid, so the agent that
 * holds it needs no reconfiguring when the person changes their mind. Revoking
 * is still there for a credential that should not exist.
 */
export function useSetBrowserAccessGrantPaused() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { errorMessage: "Failed to change the browser access grant." },
    mutationFn: (args: { grantId: string; paused: boolean }) =>
      sdk.system.setBrowserAccessGrantPaused(args.grantId, args.paused),
    onSuccess: (grants) => {
      setBrowserAccessGrants({ grants, queryClient });
    },
  });
}

/**
 * Answer an agent's request for browser access (#135). Allowing mints the
 * grant on the server, at the level chosen, and the agent collects its key.
 */
export function useDecideBrowserAccessRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { errorMessage: "Failed to answer the browser access request." },
    mutationFn: (
      args: { requestId: string } & SystemBrowserAccessRequestDecideRequest,
    ) => {
      const { requestId, ...answer } = args;
      return sdk.system.decideBrowserAccessRequest(requestId, answer);
    },
    onSuccess: (_requests, { requestId }) => {
      reconcileAnsweredBrowserAccessRequest({ queryClient, requestId });
    },
  });
}

/** Replace the sparse server-backed keyboard overrides for every app window. */
export function useUpdateKeyboardSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update keyboard shortcuts.",
    },
    mutationFn: (overrides: AppKeybindingOverrides) =>
      sdk.system.updateKeyboardSettings(overrides),
    onMutate: (overrides) =>
      beginKeyboardSettingsCacheTransaction({ overrides, queryClient }),
    onError: (_error, _overrides, context) => {
      rollbackKeyboardSettingsCacheTransaction({
        queryClient,
        transaction: context,
      });
    },
    onSuccess: () => {
      invalidateSystemConfig({ queryClient });
    },
  });
}

/**
 * Copy Patcher's built-in CLI skills into the chosen machines' global agent skill
 * roots so agents outside Patcher can drive it. A successful install on the primary
 * machine also records a yes to the launch-time question (#141); the server's
 * `config-changed` refreshes the config for that, so nothing is invalidated here.
 */
export function useInstallCliCommand() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to put `patcher` on PATH.",
    },
    mutationFn: (args: SystemInstallCliCommandRequest) =>
      sdk.system.installCliCommand(args),
    // The server announces a change to other windows, but only when the disk
    // actually moved; this window's own row refreshes either way, because
    // "occupied" and "not on PATH" are answers it should show at once.
    onSettled: () => {
      invalidateCliCommandStatus({ queryClient });
    },
  });
}

export function useInstallCliSkills() {
  return useMutation({
    meta: {
      errorMessage: "Failed to install the Patcher CLI skills.",
    },
    mutationFn: (args: SystemInstallCliSkillsRequest) =>
      sdk.system.installCliSkills(args),
  });
}

/**
 * Answer the launch-time question about installing the CLI skills for agents
 * outside Patcher (#141). The answer arrives in the system config, and an
 * accept changes what the skills status says, so both are refreshed here; other
 * windows hear the server's `config-changed`.
 */
export function useSetupCliSkills() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to set up the Patcher skills for other agents.",
    },
    mutationFn: (args: SystemCliSkillsSetupRequest) =>
      sdk.system.setupCliSkills(args),
    // Settled rather than succeeded: an accept is recorded before its install
    // runs, so a request that fails afterwards has still changed the answer.
    onSettled: () => {
      invalidateSystemConfig({ queryClient });
      invalidateCliSkillsStatus({ queryClient });
    },
  });
}

/**
 * Answer the question about a skill that shipped after the CLI skills were
 * first installed (#142). Like the launch-time question, the answer arrives in
 * the system config and an accept changes what the skills status says, so both
 * are refreshed; other windows hear the server's `config-changed`.
 */
export function useAnswerCliSkillsOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to install the new Patcher skill for other agents.",
    },
    mutationFn: (args: SystemCliSkillsOfferRequest) =>
      sdk.system.answerCliSkillsOffer(args),
    // Settled rather than succeeded: the answer is recorded before the install
    // runs, so a request that fails afterwards has still settled it.
    onSettled: () => {
      invalidateSystemConfig({ queryClient });
      invalidateCliSkillsStatus({ queryClient });
    },
  });
}

/**
 * Set the complete app-wide appearance: the palette id (built-in id or custom
 * theme name) and favicon tint. Like experiments, the server broadcasts
 * `config-changed` for other windows; the local invalidation refreshes this one.
 */
export function useUpdateAppearance() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update appearance.",
    },
    mutationFn: (selection: AppThemeSelection) => sdk.theme.set(selection),
    onSuccess: () => {
      invalidateSystemConfig({ queryClient });
    },
  });
}
