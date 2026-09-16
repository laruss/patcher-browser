import { getAnsweredCliSkills, listNonDestroyedHostsByIds } from "@patcher/db";
import type {
  HostGlobalSkillsStatusResult,
  HostInstallGlobalSkill,
} from "@patcher/host-daemon-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { AppDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import {
  clearOfferedSkills,
  noteNewCliSkills,
  readMachineSkillEntries,
  recordAcceptedWhenPrimaryHasCopies,
  resolveGlobalCliSkills,
  resolveMachineSkillStatus,
  type GlobalSkillInstallDeps,
} from "./global-skill-install.js";

type GlobalSkillReconcileDeps = GlobalSkillInstallDeps &
  Pick<AppDeps, "cliSkillsUpdateNotices">;

/**
 * Which copies on one machine this server should bring up to date on its own
 * (#142), as conditional installs: each replaces a copy only while its bytes
 * still hash to the given tree.
 *
 * Only a copy this install wrote and nobody changed since — its bytes equal
 * what the machine's record says was installed there — and that differs from
 * this server's tree. A copy edited by hand, removed, installed before the
 * record existed, or written by another install sharing the home (a release
 * and a source checkout) is left as it is; Settings says so, and Install is
 * how a person replaces it. Those two installs therefore never take turns
 * rewriting the same files: neither's copy is ever the other's own.
 *
 * A copy already holding this server's tree that the record does not list as
 * such is adopted — recorded without being rewritten — so it is kept current
 * from the next update on.
 */
export function planCliSkillsUpdate(args: {
  entries: HostGlobalSkillsStatusResult["entries"];
  skills: readonly HostInstallGlobalSkill[];
}): HostInstallGlobalSkill[] {
  return args.skills.flatMap((skill) => {
    const copies = args.entries.filter((entry) => entry.name === skill.name);
    // Distinct, because the two roots can hold two different trees this
    // install wrote — one swap succeeded, the other failed — and each needs
    // its own condition.
    const ownOutdatedTreeHashes = new Set(
      copies.flatMap((copy) =>
        copy.treeHash !== null &&
        copy.treeHash === copy.installedTreeHash &&
        copy.treeHash !== skill.treeHash
          ? [copy.treeHash]
          : [],
      ),
    );
    const adoptable = copies.some(
      (copy) =>
        copy.treeHash === skill.treeHash &&
        copy.installedTreeHash !== skill.treeHash,
    );
    return [
      ...[...ownOutdatedTreeHashes].map((treeHash) => ({
        ...skill,
        replaceOnlyIfTreeHash: treeHash,
      })),
      ...(adoptable
        ? [{ ...skill, replaceOnlyIfTreeHash: skill.treeHash }]
        : []),
    ];
  });
}

/** Strictly after every notice already held, so a window never misses one. */
function nextNoticeAt(deps: GlobalSkillReconcileDeps): number {
  const latest = Math.max(
    0,
    ...[...deps.cliSkillsUpdateNotices.values()].map((notice) => notice.at),
  );
  return Math.max(Date.now(), latest + 1);
}

async function reconcileHost(
  deps: GlobalSkillReconcileDeps,
  hostId: string,
): Promise<void> {
  const [host] = listNonDestroyedHostsByIds(deps.db, [hostId]);
  if (host === undefined || !deps.hub.hasDaemonForHost(hostId)) return;
  const skills = resolveGlobalCliSkills(deps);
  if (skills.length === 0) return;

  let entries: HostGlobalSkillsStatusResult["entries"];
  try {
    entries = await readMachineSkillEntries(deps, { hostId, skills });
  } catch (error) {
    deps.logger.debug(
      { hostId, err: error },
      "Could not read the Patcher CLI skill status from a machine that connected",
    );
    return;
  }
  // The same read answers #141's question for an install that already has
  // the skills on its primary machine.
  recordAcceptedWhenPrimaryHasCopies(deps, [
    {
      hostId,
      hostName: host.name,
      status: resolveMachineSkillStatus({ entries, skills }),
    },
  ]);

  noteNewCliSkills(deps, { entries, hostId, skills });
  // A skill the person accepted while this machine was away, or whose install
  // failed then, or that reached one root and not the other: the answer
  // outlives the question, so the machine acts on it when it connects rather
  // than sitting at "Partly installed" for good. Only while the copies that
  // are there are this install's and current — an unconditional install writes
  // both roots, and a copy somebody changed is not ours to overwrite.
  const answered = getAnsweredCliSkills(deps.db);
  const acceptedButMissing = skills.filter((skill) => {
    if (answered[skill.name] !== "accepted") return false;
    const copies = entries.filter((entry) => entry.name === skill.name);
    if (!copies.some((copy) => copy.treeHash === null)) return false;
    return copies
      .filter((copy) => copy.treeHash !== null)
      .every(
        (copy) =>
          copy.treeHash === skill.treeHash &&
          copy.installedTreeHash === skill.treeHash,
      );
  });
  const plan = [
    ...planCliSkillsUpdate({ entries, skills }),
    ...acceptedButMissing,
  ];
  if (plan.length === 0) return;
  let installations;
  try {
    ({ installations } = await callHostOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: { type: "host.install_global_skills", skills: plan },
    }));
  } catch (error) {
    deps.logger.warn(
      { hostId, err: error },
      "Could not update the Patcher CLI skills on a machine that connected",
    );
    return;
  }

  const updated = [
    ...new Set(
      installations.flatMap((installation) =>
        installation.outcome === "written" ? [installation.name] : [],
      ),
    ),
  ];
  // What the catch-up just put there is no longer missing, whatever the next
  // status read says.
  clearOfferedSkills(deps, {
    hostId,
    skillNames: acceptedButMissing.map((skill) => skill.name),
  });
  // Adopting changes nothing a person or an agent would notice.
  if (updated.length === 0) return;
  deps.cliSkillsUpdateNotices.set(hostId, {
    hostId,
    hostName: host.name,
    skills: updated,
    at: nextNoticeAt(deps),
  });
  deps.logger.info(
    { hostId, skills: updated },
    "Updated the Patcher CLI skills on a machine that connected",
  );
  deps.hub.notifySystem(["config-changed"]);
}

/**
 * Bring the Patcher skills on a machine that just connected up to date, and
 * record #141's answer when its primary machine already has them. Any machine,
 * not only the primary: copies installed through the machine picker are
 * installed too, and the own-copy rule makes updating them safe everywhere.
 *
 * One at a time per machine *session*, against reconnect storms. Keyed by the
 * session rather than the machine because a reconnect replaces the session: the
 * RPC of a run still out on the old socket is rejected when the new one
 * registers, and joining that run would leave the machine that is now connected
 * unreconciled until its next connect.
 */
export function reconcileGlobalCliSkills(
  deps: GlobalSkillReconcileDeps,
  args: { hostId: string; sessionId: string },
): Promise<void> {
  return deps.lifecycleDedupers.globalCliSkillsReconciliation.run(
    `${args.hostId}:${args.sessionId}`,
    () => reconcileHost(deps, args.hostId),
  );
}

export function scheduleGlobalCliSkillsReconciliation(
  deps: GlobalSkillReconcileDeps,
  args: { hostId: string; sessionId: string },
): void {
  void reconcileGlobalCliSkills(deps, args).catch((error: unknown) => {
    deps.logger.warn(
      { hostId: args.hostId, err: error },
      "Could not reconcile the Patcher CLI skills on a machine that connected",
    );
  });
}
