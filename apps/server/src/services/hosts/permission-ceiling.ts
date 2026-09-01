import { getEnvironment, getHost } from "@patcher/db";
import {
  clampPermissionModeToCeiling,
  DEFAULT_HOST_MAX_PERMISSION_MODE,
  permissionModeRank,
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
  /**
   * The mode of the turn that asked for this work, when a turn asked.
   *
   * A turn cannot arrange for more privilege than it has — for a thread it
   * spawns or for its own next turn. Without this the only bound is the
   * machine's, so on a machine whose owner raised the ceiling to Full Access
   * one sandboxed turn could ask for an unsandboxed one and get it, which is
   * the sandbox asking itself for permission.
   *
   * Null for the app, the CLI in a person's hands, and the server's own
   * internal sends: a person is not bounded by a turn.
   */
  requesterCeiling?: PermissionMode | null;
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
 * The bound when no machine has been named.
 *
 * Not a machine's ceiling — that is `getHostPermissionCeiling`. Nothing has been
 * chosen yet, so there is no limit of a machine's that could apply, and the
 * two callers that reach this both need every mode to stay on the table: the
 * composer, which has to offer them before a machine exists, and a thread whose
 * `environmentId` is null, which is ordinary rather than exceptional
 * (destroying an environment sets its threads' to null, and those threads are
 * still asked what mode they run at).
 *
 * So a mode is not lowered here, and this is never the last word about a turn:
 * the machine's limit is applied again with the machine in hand —
 * `toRuntimeExecutionOptions` clamps every set of execution options the daemon
 * is handed, and its `hostId` is a `string` — while what the provider can run
 * at all is checked separately, by `validateProviderPermissionMode` on the same
 * plan paths. What changes by naming it is that the fail-open is stated where a
 * reader meets it, instead of living inside a lookup whose name promises a
 * machine's answer.
 */
export const PERMISSION_CEILING_WITH_NO_MACHINE: PermissionMode = "full";

/**
 * The machine's permission ceiling.
 *
 * A missing row is a bug, not a machine that allows everything, so it reports
 * the sandbox default: the caller still fails on the real "host not found"
 * path, and until it does the fallback grants less rather than more.
 *
 * A machine is required. "No machine" is a different question with a different
 * answer, and a function that took `null` here answered it silently — the one
 * shape a security-relevant lookup should not have.
 */
export function getHostPermissionCeiling(
  deps: PermissionCeilingDeps,
  hostId: string,
): PermissionMode {
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
 * Resolve a requested mode against the machine's ceiling, and against the
 * asking turn's own mode when a turn is what asked.
 *
 * Work never fails because someone asked for too much — it runs at the highest
 * mode every applicable bound allows — but a provider that supports nothing
 * that low cannot run there at all, and that is an error.
 */
export function clampPermissionModeToHost(
  deps: PermissionCeilingDeps,
  args: ClampPermissionModeToHostArgs,
): PermissionMode {
  const hostCeiling =
    args.hostId === null
      ? PERMISSION_CEILING_WITH_NO_MACHINE
      : getHostPermissionCeiling(deps, args.hostId);
  const requesterCeiling = args.requesterCeiling ?? null;
  // The lower of the two bounds, so neither can be talked around by the other.
  const ceiling =
    requesterCeiling !== null &&
    permissionModeRank(requesterCeiling) < permissionModeRank(hostCeiling)
      ? requesterCeiling
      : hostCeiling;
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
      ceiling === hostCeiling
        ? `This machine limits permission mode to ${ceiling}, and provider ${args.providerId} requires a higher mode.`
        : `The turn asking for this runs at ${ceiling}, and provider ${args.providerId} requires a higher mode.`,
    );
  }
  return clamped;
}
