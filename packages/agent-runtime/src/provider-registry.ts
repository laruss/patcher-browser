/**
 * Provider registry.
 *
 * Manages the set of available built-in provider metadata and adapter factories
 * (codex, claude-code, pi).
 */

import {
  getBuiltInAgentProviderInfo,
  isAcpProviderId,
  isAgentProviderId,
  listBuiltInAgentProviderInfos,
} from "@patcher/agent-providers";
import type { ProviderInfo } from "@patcher/domain";
import { createAcpProviderAdapter } from "./acp/adapter.js";
import {
  acpProfileFromLaunchSpec,
  ACP_AGENT_PROFILES,
} from "./acp/profiles.js";
import { createClaudeCodeProviderAdapter } from "./claude-code/adapter.js";
import { createCodexProviderAdapter } from "./codex/adapter.js";
import { createPiProviderAdapter } from "./pi/adapter.js";
import { PI_BRIDGE_STATE_DIRS, PI_PROVIDER_ID } from "./pi/bridge-sandbox.js";
import type {
  ProviderAdapter,
  ProviderAdapterFactoryOptions,
} from "./provider-adapter.js";

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

type ProviderFactory = (
  options: ProviderAdapterFactoryOptions,
) => ProviderAdapter;
interface BuiltInProviderDescriptor {
  createAdapter: ProviderFactory;
  info: ProviderInfo;
}

const builtInProviders = [
  {
    // Codex app-server events already carry Codex-owned turn ids; the
    // runtime-generated prefix is only for adapters that synthesize Patcher turn ids.
    createAdapter: (options) => createCodexProviderAdapter(options),
    info: getBuiltInAgentProviderInfo("codex"),
  },
  {
    createAdapter: (options) => createClaudeCodeProviderAdapter(options),
    info: getBuiltInAgentProviderInfo("claude-code"),
  },
  {
    createAdapter: (options) => createPiProviderAdapter(options),
    info: getBuiltInAgentProviderInfo("pi"),
  },
  ...ACP_AGENT_PROFILES.map((profile) => ({
    createAdapter: (options: ProviderAdapterFactoryOptions) =>
      createAcpProviderAdapter({ ...options, profile }),
    info: getBuiltInAgentProviderInfo(profile.providerId),
  })),
] satisfies BuiltInProviderDescriptor[];

const builtInProvidersById = new Map(
  builtInProviders.map((descriptor) => [descriptor.info.id, descriptor]),
);

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Create a provider adapter by ID.
 *
 * Looks up built-in providers. Throws if the ID is not found.
 */
export function createProviderForId(
  providerId: string,
  options?: ProviderAdapterFactoryOptions,
): ProviderAdapter {
  if (!isAgentProviderId(providerId) && options?.acpLaunchSpec) {
    if (!isAcpProviderId(providerId)) {
      throw new Error(
        `ACP launch spec supplied for non-ACP provider "${providerId}".`,
      );
    }
    const adapterOptions = toProviderAdapterFactoryOptions(options);
    return createAcpProviderAdapter({
      ...adapterOptions,
      profile: acpProfileFromLaunchSpec(options.acpLaunchSpec, providerId),
    });
  }

  if (!isAgentProviderId(providerId)) {
    const allIds = builtInProviders.map((provider) => provider.info.id);
    throw new Error(
      `Unsupported provider "${providerId}". Available providers: ${allIds.join(", ")}.`,
    );
  }

  const descriptor = builtInProvidersById.get(providerId);

  if (!descriptor) {
    const allIds = builtInProviders.map((provider) => provider.info.id);
    throw new Error(
      `Unsupported provider "${providerId}". Available providers: ${allIds.join(", ")}.`,
    );
  }

  const adapterOptions = toProviderAdapterFactoryOptions(options);

  return descriptor.createAdapter(adapterOptions);
}

function toProviderAdapterFactoryOptions(
  options?: ProviderAdapterFactoryOptions,
): ProviderAdapterFactoryOptions {
  return {
    additionalWorkspaceWriteRoots: options?.additionalWorkspaceWriteRoots ?? [],
    protectedCredentialPaths: options?.protectedCredentialPaths ?? [],
    protectedRepositoryPaths: options?.protectedRepositoryPaths ?? [],
    ...(options?.acpLaunchSpec !== undefined
      ? { acpLaunchSpec: options.acpLaunchSpec }
      : {}),
    ...(options?.bridgeBundleDir !== undefined
      ? { bridgeBundleDir: options.bridgeBundleDir }
      : {}),
    ...(options?.bridgeNodeEnv !== undefined
      ? { bridgeNodeEnv: options.bridgeNodeEnv }
      : {}),
    ...(options?.bridgeNodeExecutablePath !== undefined
      ? { bridgeNodeExecutablePath: options.bridgeNodeExecutablePath }
      : {}),
    ...(options?.turnIdPrefix !== undefined
      ? { turnIdPrefix: options.turnIdPrefix }
      : {}),
    // Explicit, like every field above: this list is what a dynamic ACP
    // provider gets, and a sandbox that silently did not reach it would present
    // as a confined turn and not be one.
    ...(options?.wrapAcpAgentLaunch !== undefined
      ? { wrapAcpAgentLaunch: options.wrapAcpAgentLaunch }
      : {}),
  };
}

/**
 * The `$HOME`-relative directories this provider's own bridge process writes,
 * for a provider whose bridge is what a sandboxed turn confines — or undefined
 * for one where it is not.
 *
 * Pi is the only such provider. Every other bridge either confines something
 * else (Codex and Claude Code carry their own sandboxes; an ACP bridge launches
 * its agent through one) or has nothing to confine, and a bridge Patcher spawns
 * for one of those must keep running unconfined, because the boundary a turn
 * promises is already somewhere else.
 *
 * A function rather than a field on the adapter: the process key is resolved
 * before any adapter exists, and the key is where the decision has to be
 * visible — a confined process and an unconfined one cannot be the same
 * process.
 */
export function providerBridgeSandboxStateDirs(
  providerId: string,
): readonly string[] | undefined {
  return providerId === PI_PROVIDER_ID ? PI_BRIDGE_STATE_DIRS : undefined;
}

/**
 * List info for all available built-in providers.
 */
export function listAvailableProviderInfos(): ProviderInfo[] {
  return listBuiltInAgentProviderInfos();
}
