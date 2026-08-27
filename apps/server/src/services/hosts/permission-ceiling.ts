import { getEnvironment, getHost } from "@patcher/db";
import {
  clampPermissionModeToCeiling,
  DEFAULT_HOST_MAX_PERMISSION_MODE,
  type PermissionMode,
} from "@patcher/domain";
import { getSupportedPermissionModes } from "@patcher/agent-providers";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";

type PermissionCeilingDeps = Pick<AppDeps, "db">;

export interface ClampPermissionModeToHostArgs {
  hostId: string | null;
  permissionMode: PermissionMode;
  providerId?: string;
}

/**
 * No permission mode at or below the machine's limit is one the provider can
 * run in, so this pairing cannot execute at all. Its own class so read paths
 * can degrade to "no default execution options" the same way they already do
 * for a provider capability mismatch, while work requests still fail loudly.
 */
export class HostPermissionCeilingConflictError extends ApiError {}

export function isHostPermissionCeilingConflictError(
  error: unknown,
): error is HostPermissionCeilingConflictError {
  return error instanceof HostPermissionCeilingConflictError;
}

/**
 * The machine's permission ceiling.
 *
 * A missing row is a bug, not a machine that allows everything, so it reports
 * the sandbox default: the caller still fails on the real "host not found"
 * path, and until it does the fallback grants less rather than more.
 *
 * No host id at all is a different question — nothing has been chosen yet, so
 * there is no machine whose limit could apply, and the compose flow still has
 * to be able to offer every mode before a machine exists. That answer stays
 * "full"; what gates a mode there is the provider's own capability list.
 */
export function getHostPermissionCeiling(
  deps: PermissionCeilingDeps,
  hostId: string | null,
): PermissionMode {
  if (hostId === null) return "full";
  return (
    getHost(deps.db, hostId)?.maxPermissionMode ??
    DEFAULT_HOST_MAX_PERMISSION_MODE
  );
}

/** The machine a thread's work lands on, or null before it has an environment. */
export function resolveEnvironmentHostId(
  deps: PermissionCeilingDeps,
  environmentId: string | null,
): string | null {
  if (environmentId === null) return null;
  return getEnvironment(deps.db, environmentId)?.hostId ?? null;
}

/**
 * Resolve a requested mode against the machine's ceiling. Work never fails
 * because someone asked for too much — it runs at the highest mode the machine
 * and the provider both allow — but a provider that supports nothing that low
 * cannot run on the machine at all, and that is an error.
 */
export function clampPermissionModeToHost(
  deps: PermissionCeilingDeps,
  args: ClampPermissionModeToHostArgs,
): PermissionMode {
  const ceiling = getHostPermissionCeiling(deps, args.hostId);
  const supported = args.providerId
    ? getSupportedPermissionModes(args.providerId)
    : null;
  const clamped = clampPermissionModeToCeiling({
    ceiling,
    permissionMode: args.permissionMode,
    ...(supported ? { supportedPermissionModes: supported } : {}),
  });
  if (clamped === null) {
    throw new HostPermissionCeilingConflictError(
      400,
      "host_permission_ceiling_conflict",
      `This machine limits permission mode to ${ceiling}, and provider ${args.providerId} requires a higher mode.`,
    );
  }
  return clamped;
}
