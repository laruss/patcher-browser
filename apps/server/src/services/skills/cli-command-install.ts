import {
  getCliCommandSetup,
  listNonDestroyedHostsByIds,
  setCliCommandSetup,
} from "@patcher/db";
import type {
  CliCommandMachine,
  SystemCliCommandSetupRequest,
  SystemCliCommandSetupResponse,
  SystemCliCommandStatusResponse,
  SystemInstallCliCommandResponse,
} from "@patcher/server-contract";
import type { HostCliCommandResult } from "@patcher/host-daemon-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import {
  requirePrimaryHostId,
  resolvePrimaryHostId,
} from "../hosts/primary-host.js";

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

/**
 * Record a yes to the bare command (#147) unless somebody already answered.
 * Announced, because a window deciding whether to ask reads it from the config.
 */
function recordCliCommandAccepted(deps: CliCommandInstallDeps): void {
  if (getCliCommandSetup(deps.db) !== "unasked") return;
  setCliCommandSetup(deps.db, "accepted");
  deps.hub.notifySystem(["config-changed"]);
}

/**
 * Where a bare `patcher` stands on each machine asked. Writes nothing to the
 * disk.
 *
 * It can record an answer, though, by #141's rule for the skills: a primary
 * machine whose command is anything but `missing` has nothing the launch-time
 * question (#147) could do for it. The question asks only on `missing`, so
 * without this a machine answering `not_on_path` would pay for this read on
 * every launch, forever, and a link somebody made by hand would bring the
 * question the day they remove it. `occupied`, `shadowed`, `not_on_path` and
 * `failed` are the person's to settle in Settings; `unknown` and `unsupported`
 * are not answers about the disk.
 */
export async function readCliCommandStatus(
  deps: CliCommandInstallDeps,
  args: { hostIds?: readonly string[] },
): Promise<SystemCliCommandStatusResponse> {
  const machines = await askEachMachine(deps, {
    hostIds: resolveHostIds(deps, args.hostIds),
    write: false,
  });
  const primaryHostId = resolvePrimaryHostId(deps);
  const primary = machines.find((machine) => machine.hostId === primaryHostId);
  if (
    primary !== undefined &&
    primary.state !== "missing" &&
    primary.state !== "unknown" &&
    primary.state !== "unsupported"
  ) {
    recordCliCommandAccepted(deps);
  }
  return { machines };
}

/**
 * Place the link on each machine asked.
 *
 * Asking for it on the primary machine is saying yes to it (#147) — from
 * Settings, from the SDK, or through #141's accept — so the answer is recorded
 * first, before anything is awaited: a place that could not be linked must not
 * put the launch-time question back, and a window refetching its config on the
 * broadcast #141's accept sends just before calling this must already read the
 * answer. Not on a source checkout, where nothing is asked at all.
 */
export async function installCliCommand(
  deps: CliCommandInstallDeps,
  args: { hostIds?: readonly string[] },
): Promise<SystemInstallCliCommandResponse> {
  const hostIds = resolveHostIds(deps, args.hostIds);
  if (
    !deps.config.isDevelopment &&
    hostIds.includes(resolvePrimaryHostId(deps) ?? "")
  ) {
    recordCliCommandAccepted(deps);
  }
  const machines = await askEachMachine(deps, { hostIds, write: true });
  if (machines.some((machine) => machine.changed)) {
    // Only when the disk moved: a second window's row is showing the old
    // answer, and nothing else tells it otherwise.
    deps.hub.notifySystem(["config-changed"]);
  }
  return { machines };
}

/**
 * The person's answer to the launch-time question about the bare `patcher`
 * command (#147), asked of an install that holds the skills but whose yes to
 * them was read off the disk, and so never carried the command with it.
 *
 * The first answer stands, for #141's reason: checked and written with no
 * await between them, so a late click in a second window settles nothing.
 * `accept` records before linking — `installCliCommand` would record too, but
 * the check here is what makes the answer the first one — and what linking
 * answered goes back to be said, an `occupied` or a `not_on_path` included.
 */
export async function answerCliCommandSetup(
  deps: CliCommandInstallDeps,
  args: SystemCliCommandSetupRequest,
): Promise<SystemCliCommandSetupResponse> {
  const current = getCliCommandSetup(deps.db);
  if (current !== "unasked") {
    return { cliCommandSetup: current, cliCommand: null };
  }
  if (args.answer === "decline") {
    setCliCommandSetup(deps.db, "declined");
    deps.hub.notifySystem(["config-changed"]);
    return { cliCommandSetup: "declined", cliCommand: null };
  }
  const primaryHostId = requirePrimaryHostId(deps);
  setCliCommandSetup(deps.db, "accepted");
  deps.hub.notifySystem(["config-changed"]);
  const cliCommand = await installCliCommand(deps, {
    hostIds: [primaryHostId],
  }).then(
    (result) => result.machines[0] ?? null,
    (error: unknown) => {
      deps.logger.warn(
        { hostId: primaryHostId, err: error },
        "Failed to put `patcher` on PATH while answering the launch-time question",
      );
      return null;
    },
  );
  return { cliCommandSetup: "accepted", cliCommand };
}
