import { listNonDestroyedHostsByIds } from "@patcher/db";
import type {
  CliCommandMachine,
  SystemCliCommandStatusResponse,
  SystemInstallCliCommandResponse,
} from "@patcher/server-contract";
import type { HostCliCommandResult } from "@patcher/host-daemon-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import { requirePrimaryHostId } from "../hosts/primary-host.js";

/**
 * A bare `patcher`, on the machine the person types on (#143).
 *
 * The daemon owns the placement — which directories are candidates, what is
 * already there, what a login shell's PATH says. What lives here is the policy
 * the daemon deliberately does not carry (invariant 3): **who may own the bare
 * command**. A source checkout may not. It shares a home with the release it
 * was built beside, so letting both write `~/.local/bin/patcher` would make the
 * word `patcher` mean whichever one started last — and the checkout already has
 * `bun run patcher` and its own shim path.
 *
 * Which machines are asked is policy too, and the answer is "the primary one,
 * unless told otherwise". A skill is a file an agent reads *wherever it runs*,
 * so every machine needs a copy; a bare command is what a **person types**, and
 * they type on the machine in front of them. On an enrolled machine the shim is
 * half-broken anyway — its data directory holds that machine's credentials but
 * no app key, so `patcher` reaches the server and is refused with a 401 until
 * `PATCHER_APP_KEY` is exported (`docs/installation.md`). The request still
 * carries `hostIds`, so widening this is not a change to the contract.
 */
export type CliCommandInstallDeps = Pick<
  AppDeps,
  | "config"
  | "db"
  | "hub"
  | "lifecycleDedupers"
  | "logger"
  | "machineAuth"
  | "skillTreeRegistry"
  | "telemetry"
>;

const STATUS_TIMEOUT_MS = 5_000;

/** The machines to ask about, defaulting to the one the person is at. */
function resolveHostIds(
  deps: CliCommandInstallDeps,
  hostIds: readonly string[] | undefined,
): readonly string[] {
  return hostIds === undefined || hostIds.length === 0
    ? [requirePrimaryHostId(deps)]
    : hostIds;
}

function machineFrom(args: {
  hostId: string;
  hostName: string;
  result: HostCliCommandResult;
}): CliCommandMachine {
  return {
    hostId: args.hostId,
    hostName: args.hostName,
    state: args.result.state,
    linkPath: args.result.linkPath,
    existingPath: args.result.existingPath,
    existingTarget: args.result.existingTarget,
    shimDirectory: args.result.shimDirectory,
    reason: args.result.reason,
    message: args.result.message,
    changed: args.result.changed,
  };
}

/** A machine nothing was asked of, because there was no point in asking. */
function machineWithout(args: {
  hostId: string;
  hostName: string;
  state: CliCommandMachine["state"];
  reason?: CliCommandMachine["reason"];
  message?: string;
}): CliCommandMachine {
  return {
    hostId: args.hostId,
    hostName: args.hostName,
    state: args.state,
    linkPath: null,
    existingPath: null,
    existingTarget: null,
    shimDirectory: null,
    reason: args.reason ?? null,
    message: args.message ?? null,
    changed: false,
  };
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function askEachMachine(
  deps: CliCommandInstallDeps,
  args: { hostIds: readonly string[]; write: boolean },
): Promise<CliCommandMachine[]> {
  const hosts = listNonDestroyedHostsByIds(deps.db, [...args.hostIds]);
  const missingHostId = args.hostIds.find(
    (hostId) => !hosts.some((host) => host.id === hostId),
  );
  if (missingHostId !== undefined) {
    throw new ApiError(
      404,
      "host_not_found",
      `Machine ${missingHostId} was not found`,
    );
  }

  return Promise.all(
    hosts.map(async (host) => {
      if (deps.config.isDevelopment) {
        // Answered without asking: a checkout's daemon would place a link
        // perfectly well, and that is exactly what must not happen.
        return machineWithout({
          hostId: host.id,
          hostName: host.name,
          state: "unsupported",
          reason: "dev-install",
        });
      }
      try {
        const result = await callHostOnlineRpc(deps, {
          hostId: host.id,
          timeoutMs: args.write ? COMMAND_TIMEOUT_MS : STATUS_TIMEOUT_MS,
          command: {
            type: args.write
              ? "host.install_cli_command"
              : "host.cli_command_status",
          },
        });
        return machineFrom({
          hostId: host.id,
          hostName: host.name,
          result,
        });
      } catch (error) {
        if (!args.write) {
          // A machine that is offline or slow to answer is not a machine whose
          // PATH we know anything about.
          return machineWithout({
            hostId: host.id,
            hostName: host.name,
            state: "unknown",
          });
        }
        deps.logger.warn(
          { hostId: host.id, err: error },
          "Failed to put `patcher` on PATH on a machine",
        );
        return machineWithout({
          hostId: host.id,
          hostName: host.name,
          state: "failed",
          message: failureMessage(error),
        });
      }
    }),
  );
}

/** Where a bare `patcher` stands on each machine asked. Writes nothing. */
export async function readCliCommandStatus(
  deps: CliCommandInstallDeps,
  args: { hostIds?: readonly string[] },
): Promise<SystemCliCommandStatusResponse> {
  return {
    machines: await askEachMachine(deps, {
      hostIds: resolveHostIds(deps, args.hostIds),
      write: false,
    }),
  };
}

/** Place the link on each machine asked. */
export async function installCliCommand(
  deps: CliCommandInstallDeps,
  args: { hostIds?: readonly string[] },
): Promise<SystemInstallCliCommandResponse> {
  const machines = await askEachMachine(deps, {
    hostIds: resolveHostIds(deps, args.hostIds),
    write: true,
  });
  if (machines.some((machine) => machine.changed)) {
    // Only when the disk moved: a second window's row is showing the old
    // answer, and nothing else tells it otherwise.
    deps.hub.notifySystem(["config-changed"]);
  }
  return { machines };
}
