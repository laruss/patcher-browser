import type { PatcherPluginApi } from "@patcher/plugin-sdk";
import type { AgentEnvironment, PermissionMode } from "./rpc-types.js";

type ProviderPermissionApi = {
  sdk: {
    providers: Pick<PatcherPluginApi["sdk"]["providers"], "list">;
  };
};

type ProviderRouting = NonNullable<
  Parameters<ProviderPermissionApi["sdk"]["providers"]["list"]>[0]
>;

/**
 * Modes that keep the agent inside the workspace sandbox, most capable first.
 *
 * The same lattice `highestSandboxedPermissionMode` implements in
 * @patcher/domain, spelled locally because a plugin bundles standalone and does
 * not depend on domain. It matters more here than anywhere: an automation runs
 * on a schedule with nobody watching, so resolving an unstated default *up* to
 * Full Access — which is what preferring "full" over "accept-edits" did for a
 * provider with no automatic reviewer, such as Cursor — makes the longest-lived
 * unsandboxed grant in the product the silent default.
 */
const SANDBOXED_PERMISSION_MODES: readonly PermissionMode[] = [
  "auto",
  "accept-edits",
];

function highestSandboxedPermissionMode(
  supported: readonly PermissionMode[],
): PermissionMode | null {
  return (
    SANDBOXED_PERMISSION_MODES.find((mode) => supported.includes(mode)) ?? null
  );
}

export function providerRoutingForEnvironment(
  environment: AgentEnvironment,
): ProviderRouting {
  if (environment.type === "reuse") {
    return { environmentId: environment.environmentId };
  }
  if (environment.type === "host" && environment.hostId !== undefined) {
    return { hostId: environment.hostId };
  }
  return {};
}

export async function resolvePermissionMode(
  patcher: ProviderPermissionApi,
  providerId: string,
  requested: PermissionMode | undefined,
  routing: ProviderRouting = {},
): Promise<PermissionMode> {
  const providers = await patcher.sdk.providers.list(routing);
  const provider = providers.find((candidate) => candidate.id === providerId);
  if (provider === undefined || provider.available === false) {
    throw new Error(`Provider ${providerId} is not available.`);
  }
  if (
    requested !== undefined &&
    !provider.capabilities.supportedPermissionModes.includes(requested)
  ) {
    throw new Error(
      `Permission mode ${requested} is not supported by provider ${providerId}.`,
    );
  }
  if (requested !== undefined) return requested;
  const sandboxed = highestSandboxedPermissionMode(
    provider.capabilities.supportedPermissionModes,
  );
  if (sandboxed !== null) return sandboxed;
  if (provider.capabilities.supportedPermissionModes.includes("full")) {
    return "full";
  }
  throw new Error(
    `Provider ${providerId} has no supported default permission mode.`,
  );
}
