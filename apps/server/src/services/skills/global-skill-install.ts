import {
  getAnsweredCliSkills,
  getOutsideAgentSetup,
  listHosts,
  listNonDestroyedHostsByIds,
  setAnsweredCliSkills,
  setOutsideAgentSetup,
} from "@patcher/db";
import type {
  CliSkillMachineStatus,
  CliSkillsOffer,
  SystemCliSkillsOfferRequest,
  SystemCliSkillsOfferResponse,
  SystemCliSkillsSetupRequest,
  SystemCliSkillsSetupResponse,
  SystemCliSkillsStatusResponse,
  SystemInstallCliSkillsResponse,
} from "@patcher/server-contract";
import type {
  HostGlobalSkillsStatusResult,
  HostInstallGlobalSkill,
} from "@patcher/host-daemon-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import {
  requirePrimaryHostId,
  resolvePrimaryHostId,
} from "../hosts/primary-host.js";
import { resolveServerOwnedSkillCatalogEntries } from "./injected-skills.js";

/**
 * The built-in skills published to a machine's global agent skill roots so
 * agents running outside Patcher can drive Patcher through its CLI.
 *
 * `patcher-browser` is here because the browser is the one capability an agent
 * outside Patcher cannot discover for itself: it is not a tool in its list, the
 * command lives behind a plugin, and the gate on it is a setting whose name
 * nothing else mentions. Without the skill the first attempt is a search of the
 * filesystem for a binary, and the second is a wrong conclusion about why a
 * refusal happened.
 */
export const GLOBAL_CLI_SKILL_NAMES: readonly string[] = [
  "patcher-cli",
  "patcher-browser",
];

/**
 * Status reads are a page-load nicety, so they give up well before the install
 * timeout rather than holding the settings row on a wedged machine.
 */
const STATUS_TIMEOUT_MS = 5_000;

/** Every enrolled machine, for callers that did not name any. */
export function listInstallableMachineIds(
  deps: GlobalSkillInstallDeps,
): string[] {
  return listHosts(deps.db).map((host) => host.id);
}

export type InstallGlobalCliSkillsResult = SystemInstallCliSkillsResponse;

export type GlobalSkillInstallDeps = Pick<
  AppDeps,
  | "cliSkillsOffers"
  | "config"
  | "db"
  | "hub"
  | "lifecycleDedupers"
  | "logger"
  | "machineAuth"
  | "skillTreeRegistry"
  | "telemetry"
>;

export interface InstallGlobalCliSkillsArgs {
  hostIds: readonly string[];
  /** Only these skills, for an install answering an offer (#142). */
  skillNames?: readonly string[];
}

/**
 * Resolve the built-in CLI skills as tree sources. Resolution also registers
 * each tree hash with the skill tree registry, which is what lets a daemon
 * pull the tree bytes back over the internal skill-tree route.
 */
export function resolveGlobalCliSkills(
  deps: GlobalSkillInstallDeps,
): HostInstallGlobalSkill[] {
  return resolveServerOwnedSkillCatalogEntries({
    builtinSkillsRootPath: deps.config.builtinSkillsRootPath,
    dataDir: deps.config.dataDir,
    logger: deps.logger,
    skillTreeRegistry: deps.skillTreeRegistry,
  }).flatMap(({ provenance, runtimeSource }) =>
    provenance.kind === "builtin" &&
    runtimeSource.kind === "tree" &&
    GLOBAL_CLI_SKILL_NAMES.includes(runtimeSource.name)
      ? [
          {
            name: runtimeSource.name,
            treeHash: runtimeSource.treeHash,
            entryPath: runtimeSource.entryPath,
          },
        ]
      : [],
  );
}

function copiesOfSkill(
  entries: HostGlobalSkillsStatusResult["entries"],
  name: string,
): HostGlobalSkillsStatusResult["entries"] {
  return entries.filter((entry) => entry.name === name);
}

/**
 * A skill this machine has never had, on an install that put the others there
 * (#142) — a skill that shipped after the person said yes once, which is worth
 * asking about rather than installing unasked or leaving out for good.
 *
 * "Never had" is both hashes null: a copy somebody removed keeps its entry in
 * the machine's record, and removing a skill is not an invitation to offer it
 * back. "The others are ours" needs a copy that is both present and this
 * install's, for the same reason.
 */
export function findNewCliSkills(args: {
  entries: HostGlobalSkillsStatusResult["entries"];
  skills: readonly HostInstallGlobalSkill[];
}): string[] {
  const ownsOthers = args.entries.some(
    (entry) => entry.treeHash !== null && entry.installedTreeHash !== null,
  );
  if (!ownsOthers) return [];
  return args.skills
    .filter((skill) => {
      const copies = copiesOfSkill(args.entries, skill.name);
      return (
        copies.length > 0 &&
        copies.every(
          (copy) => copy.treeHash === null && copy.installedTreeHash === null,
        )
      );
    })
    .map((skill) => skill.name);
}

/**
 * Keep the machine's offer in step with what it just reported. Every status
 * read passes through here — the one a connect makes and the one a settings
 * page makes — so a read that timed out is made good by the next, and an
 * install from anywhere is noticed without waiting for a reconnect.
 */
export function noteNewCliSkills(
  deps: GlobalSkillInstallDeps,
  args: {
    entries: HostGlobalSkillsStatusResult["entries"];
    hostId: string;
    skills: readonly HostInstallGlobalSkill[];
  },
): void {
  const newNames = findNewCliSkills(args);
  const current = deps.cliSkillsOffers.get(args.hostId) ?? [];
  if (current.join("\u0000") === newNames.join("\u0000")) return;
  if (newNames.length === 0) deps.cliSkillsOffers.delete(args.hostId);
  else deps.cliSkillsOffers.set(args.hostId, newNames);
  deps.hub.notifySystem(["config-changed"]);
}

/** Drop names an install has just put in place, so nothing asks about them. */
function clearOfferedSkills(
  deps: GlobalSkillInstallDeps,
  args: { hostId: string; skillNames: readonly string[] },
): void {
  const current = deps.cliSkillsOffers.get(args.hostId);
  if (current === undefined) return;
  const left = current.filter((name) => !args.skillNames.includes(name));
  if (left.length === 0) deps.cliSkillsOffers.delete(args.hostId);
  else deps.cliSkillsOffers.set(args.hostId, left);
}

/**
 * What the window asks about, if anything: the skills no machine has that
 * nobody has answered for yet, and the machines they would be installed on.
 */
export function resolveCliSkillsOffer(
  deps: GlobalSkillInstallDeps,
): CliSkillsOffer | null {
  const answered = getAnsweredCliSkills(deps.db);
  const unanswered = [...deps.cliSkillsOffers.entries()]
    .map(
      ([hostId, names]) =>
        [hostId, names.filter((name) => answered[name] === undefined)] as const,
    )
    .filter(([, names]) => names.length > 0);
  if (unanswered.length === 0) return null;
  const hosts = listNonDestroyedHostsByIds(
    deps.db,
    unanswered.map(([hostId]) => hostId),
  );
  if (hosts.length === 0) return null;
  return {
    skills: [...new Set(unanswered.flatMap(([, names]) => names))].sort(),
    machines: hosts.map((host) => ({ hostId: host.id, hostName: host.name })),
  };
}

/**
 * Compare what a machine has installed against what this server would install.
 * Every expected copy must match for "installed"; nothing present at all is
 * "missing". Of the rest, a copy changed since this install wrote it makes the
 * machine "modified" — the one case an automatic update never touches, so it
 * is named first — then a copy absent beside present ones "incomplete", and
 * anything else, an older copy, "outdated".
 */
export function resolveMachineSkillStatus(args: {
  entries: HostGlobalSkillsStatusResult["entries"];
  skills: readonly HostInstallGlobalSkill[];
}): CliSkillMachineStatus {
  const expectedByName = new Map(
    args.skills.map((skill) => [skill.name, skill.treeHash]),
  );
  const relevant = args.entries.filter((entry) =>
    expectedByName.has(entry.name),
  );
  const present = relevant.filter((entry) => entry.treeHash !== null);
  if (present.length === 0) return "missing";
  const isCurrent = (entry: (typeof relevant)[number]) =>
    entry.treeHash === expectedByName.get(entry.name);
  if (present.length === relevant.length && relevant.every(isCurrent)) {
    return "installed";
  }
  const changedSinceInstalled = present.some(
    (entry) =>
      !isCurrent(entry) &&
      entry.installedTreeHash !== null &&
      entry.treeHash !== entry.installedTreeHash,
  );
  if (changedSinceInstalled) return "modified";
  return present.length < relevant.length ? "incomplete" : "outdated";
}

/**
 * Ask one machine for the raw state of its copies. Throws when the machine
 * cannot answer; callers decide whether that is "unknown" or nothing to do.
 */
export async function readMachineSkillEntries(
  deps: GlobalSkillInstallDeps,
  args: { hostId: string; skills: readonly HostInstallGlobalSkill[] },
): Promise<HostGlobalSkillsStatusResult["entries"]> {
  const result = await callHostOnlineRpc(deps, {
    hostId: args.hostId,
    timeoutMs: STATUS_TIMEOUT_MS,
    command: {
      type: "host.global_skills_status",
      names: args.skills.map((skill) => skill.name),
    },
  });
  return result.entries;
}

/**
 * Read each requested machine's install status. A machine that is offline or
 * fails to answer reports "unknown" rather than failing the whole read — the
 * settings row still renders for the machines that did answer.
 */
export async function readGlobalCliSkillStatus(
  deps: GlobalSkillInstallDeps,
  args: InstallGlobalCliSkillsArgs,
): Promise<SystemCliSkillsStatusResponse> {
  const hosts = listNonDestroyedHostsByIds(deps.db, args.hostIds);
  const skills = resolveGlobalCliSkills(deps);
  const machines = await Promise.all(
    hosts.map(async (host) => {
      const base = { hostId: host.id, hostName: host.name };
      if (skills.length === 0 || !deps.hub.hasDaemonForHost(host.id)) {
        return { ...base, status: "unknown" as const };
      }
      try {
        const entries = await readMachineSkillEntries(deps, {
          hostId: host.id,
          skills,
        });
        noteNewCliSkills(deps, { entries, hostId: host.id, skills });
        return {
          ...base,
          status: resolveMachineSkillStatus({ entries, skills }),
        };
      } catch (error) {
        deps.logger.debug(
          { hostId: host.id, err: error },
          "Could not read the Patcher CLI skill status from a machine",
        );
        return { ...base, status: "unknown" as const };
      }
    }),
  );
  recordAcceptedWhenPrimaryHasCopies(deps, machines);
  return { machines };
}

function installFailureMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().length > 0 ? message : "The install failed";
}

/**
 * Copy the built-in Patcher CLI skills onto each requested machine. The server picks
 * the skills; each daemon owns the destinations. Machines install concurrently
 * and independently, so one offline machine never blocks the others.
 */
export async function installGlobalCliSkills(
  deps: GlobalSkillInstallDeps,
  args: InstallGlobalCliSkillsArgs,
): Promise<InstallGlobalCliSkillsResult> {
  const hosts = listNonDestroyedHostsByIds(deps.db, args.hostIds);
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
  const skills = resolveGlobalCliSkills(deps);
  if (skills.length === 0) {
    throw new ApiError(
      500,
      "cli_skill_unavailable",
      "The built-in Patcher CLI skill is unavailable on this server",
    );
  }
  // An answer names skills this server resolved a moment ago, so an empty
  // selection means they are gone from under it — nothing to install, rather
  // than an install of everything.
  const selected =
    args.skillNames === undefined
      ? skills
      : skills.filter((skill) => args.skillNames?.includes(skill.name));
  if (selected.length === 0) return { results: [] };

  const results = await Promise.all(
    hosts.map(async (host) => {
      try {
        const result = await callHostOnlineRpc(deps, {
          hostId: host.id,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: { type: "host.install_global_skills", skills: selected },
        });
        clearOfferedSkills(deps, {
          hostId: host.id,
          skillNames: selected.map((skill) => skill.name),
        });
        return {
          ok: true as const,
          hostId: host.id,
          hostName: host.name,
          installations: result.installations.flatMap((installation) =>
            installation.outcome === "skipped"
              ? []
              : [{ name: installation.name, path: installation.path }],
          ),
        };
      } catch (error) {
        deps.logger.warn(
          { hostId: host.id, err: error },
          "Failed to install the Patcher CLI skills on a machine",
        );
        return {
          ok: false as const,
          hostId: host.id,
          hostName: host.name,
          errorMessage: installFailureMessage(error),
        };
      }
    }),
  );
  recordAcceptedWhenPrimaryInstalled(deps, results);
  // Every window showing a machine's skill status learns it may have changed,
  // not only the one that asked for the install: the app re-reads the status on
  // `config-changed`, which also carries an answer recorded just above.
  deps.hub.notifySystem(["config-changed"]);
  return { results };
}

/**
 * Pressing Install — in Settings, at a terminal, or in the launch-time question —
 * is saying yes to it, so a successful install on the primary machine records
 * the answer too (#141). The install's own broadcast announces it.
 */
function recordAcceptedWhenPrimaryInstalled(
  deps: GlobalSkillInstallDeps,
  results: InstallGlobalCliSkillsResult["results"],
): void {
  const primaryHostId = resolvePrimaryHostId(deps);
  const installedOnPrimary = results.some(
    (entry) => entry.ok && entry.hostId === primaryHostId,
  );
  if (!installedOnPrimary || getOutsideAgentSetup(deps.db) === "accepted") {
    return;
  }
  setOutsideAgentSetup(deps.db, "accepted");
}

/**
 * An install whose primary machine already holds the skills has answered the
 * launch-time question (#141): somebody installed them. Recorded rather than
 * merely not asked, so removing the copies later does not bring the question
 * back.
 *
 * Recorded by whichever status read of the primary machine first gets an
 * answer — the connect-time read, or the window's own read before it decides
 * whether to ask — so a connect-time read that timed out is made good by the
 * next one rather than lost. `unknown` records nothing, and `missing` is the
 * case the question is for.
 */
export function recordAcceptedWhenPrimaryHasCopies(
  deps: GlobalSkillInstallDeps,
  machines: SystemCliSkillsStatusResponse["machines"],
): void {
  const primaryHostId = resolvePrimaryHostId(deps);
  const primary = machines.find((machine) => machine.hostId === primaryHostId);
  if (
    primary === undefined ||
    primary.status === "missing" ||
    primary.status === "unknown"
  ) {
    return;
  }
  if (getOutsideAgentSetup(deps.db) !== "unasked") return;
  setOutsideAgentSetup(deps.db, "accepted");
  deps.hub.notifySystem(["config-changed"]);
}

/**
 * The person's answer about the skills that shipped after they first said yes
 * (#142).
 *
 * The server answers the offer it holds rather than one the window names, so a
 * second window clicking late settles nothing new. Recorded before the install
 * runs, for #141's reason: an install that fails must not put the question back
 * on every launch. An accept outlives this call — a machine that was offline
 * installs the skill when it next connects.
 */
export async function answerCliSkillsOffer(
  deps: GlobalSkillInstallDeps,
  args: SystemCliSkillsOfferRequest,
): Promise<SystemCliSkillsOfferResponse> {
  const offer = resolveCliSkillsOffer(deps);
  if (offer === null) return { answered: [], install: null };
  const answer = args.answer === "accept" ? "accepted" : "declined";
  setAnsweredCliSkills(deps.db, {
    ...getAnsweredCliSkills(deps.db),
    ...Object.fromEntries(offer.skills.map((name) => [name, answer] as const)),
  });
  // Snapshotted before the offer is cleared: these are the machines the person
  // was shown.
  const hostIds = offer.machines.map((machine) => machine.hostId);
  for (const hostId of hostIds) {
    clearOfferedSkills(deps, { hostId, skillNames: offer.skills });
  }
  if (args.answer === "decline") {
    deps.hub.notifySystem(["config-changed"]);
    return { answered: offer.skills, install: null };
  }
  const install = await installGlobalCliSkills(deps, {
    hostIds,
    skillNames: offer.skills,
  });
  return { answered: offer.skills, install };
}

/**
 * The person's answer to the launch-time question (#141).
 *
 * `accept` records the answer **before** installing. An install can fail — the
 * machine dropped off, a root is not writable — and recording afterwards would
 * put the same question back in front of them on every launch until it
 * succeeded. The per-machine outcome goes back to the window to show, and
 * Settings → Skills is where they try again.
 */
export async function answerCliSkillsSetup(
  deps: GlobalSkillInstallDeps,
  args: SystemCliSkillsSetupRequest,
): Promise<SystemCliSkillsSetupResponse> {
  // The first answer stands. Two windows can both be showing the question, and
  // a late click in one must not undo what the other already answered; a
  // change of mind later goes through Settings → Skills. Checked and written
  // with no await between them, so two requests cannot both pass the check.
  const current = getOutsideAgentSetup(deps.db);
  if (current !== "unasked") {
    return { outsideAgentSetup: current, install: null };
  }
  if (args.answer === "decline") {
    setOutsideAgentSetup(deps.db, "declined");
    deps.hub.notifySystem(["config-changed"]);
    return { outsideAgentSetup: "declined", install: null };
  }
  const primaryHostId = requirePrimaryHostId(deps);
  setOutsideAgentSetup(deps.db, "accepted");
  deps.hub.notifySystem(["config-changed"]);
  const install = await installGlobalCliSkills(deps, {
    hostIds: [primaryHostId],
  });
  return { outsideAgentSetup: "accepted", install };
}
