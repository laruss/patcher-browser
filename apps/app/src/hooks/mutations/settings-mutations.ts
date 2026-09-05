import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type AppKeybindingOverrides,
  type AppSettings,
  type AppThemeSelection,
  type Experiments,
} from "@patcher/domain";
import type {
  SystemBrowserExternalAccessRequest,
  SystemInstallCliSkillsRequest,
} from "@patcher/server-contract";
import { sdk } from "@/lib/sdk";
import { allPluginListQueryKeyPrefix } from "../queries/plugin-settings-queries";
import {
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
      void queryClient.invalidateQueries({
        queryKey: allPluginListQueryKeyPrefix(),
      });
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
 * roots so agents outside Patcher can drive it. Purely a filesystem action on those
 * machines — nothing in the system config changes, so nothing is invalidated.
 */
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
    mutationFn: (selection: AppThemeSelection) =>
      sdk.theme.set(selection),
    onSuccess: () => {
      invalidateSystemConfig({ queryClient });
    },
  });
}
