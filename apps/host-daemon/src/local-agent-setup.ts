import os from "node:os";
import { writeCliShim, type CliShimTarget } from "@patcher/config/cli-shim";
import { pruneRenamedGlobalSkills } from "./command-handlers/install-global-skills.js";
import type { HostDaemonLogger } from "./logger.js";

/**
 * Two things this machine needs before an agent that is *not* one of Patcher's
 * turns can use it, done once at daemon startup.
 *
 * Both belong to the daemon rather than to the server, and for the same reason:
 * they are facts about a machine, and the server may be on a different one. The
 * daemon is the process that already resolves this install's `patcher` binary
 * and already writes into the user's home.
 *
 * Neither is allowed to stop the daemon. A read-only data directory, a home
 * directory somebody has locked down — those should cost the convenience, not
 * the machine.
 */

export interface PrepareLocalAgentAccessArgs {
  dataDir: string;
  /** Absolute path to this install's CLI, already checked by the caller. */
  patcherExecutablePath: string;
  /**
   * Which install a bare `patcher` should reach.
   *
   * The same values the daemon puts in a turn's shell environment, minus the
   * app key: without them the CLI falls back to the production defaults, which
   * on a source checkout or a non-default server is a different install.
   */
  target: CliShimTarget;
  logger: HostDaemonLogger;
  /** Defaults to this host's home directory; injected by tests. */
  homeDir?: string;
  platform?: NodeJS.Platform;
}

/**
 * Put `patcher` somewhere findable, and take the old name's skills away.
 *
 * **The shim.** A turn's shell is handed the CLI on its PATH *and* told which
 * server to reach; nothing does either for Claude Code, Codex, or a person's own
 * terminal, and the binary lives somewhere unguessable — inside a `.app` bundle,
 * or an npm cache. So the daemon writes `<dataDir>/bin/patcher`, which is the
 * same path on every install and therefore something a document can name, and
 * which carries this install's server and data directory so the command reaches
 * the Patcher that wrote it rather than the production defaults.
 *
 * **The prune.** `bb-cli` was this product's CLI skill under its old name, and it
 * lives in the user's *global* skill roots — outside the data directory, so the
 * rename never reached it. Claude Code loads it beside the new one and follows
 * it onto a binary this fork no longer ships. It was already removed on every
 * install of the CLI skills, which is a button nobody has to press; doing it at
 * startup is what makes the removal reach a machine whose user never pressed it.
 */
export async function prepareLocalAgentAccess(
  args: PrepareLocalAgentAccessArgs,
): Promise<void> {
  const shim = await writeCliShim({
    dataDir: args.dataDir,
    executablePath: args.patcherExecutablePath,
    target: args.target,
    ...(args.platform === undefined ? {} : { platform: args.platform }),
  });
  if (shim.outcome === "written") {
    args.logger.info(
      {
        path: shim.path,
        executable: args.patcherExecutablePath,
        serverUrl: args.target.serverUrl,
      },
      "Wrote the patcher CLI shim",
    );
  } else if (shim.outcome === "failed") {
    args.logger.warn(
      { error: String(shim.error) },
      "Could not write the patcher CLI shim; agents outside Patcher will have to name the binary themselves",
    );
  }

  try {
    const removed = await pruneRenamedGlobalSkills({
      homeDir: args.homeDir ?? os.homedir(),
    });
    if (removed.length > 0) {
      args.logger.info(
        { skills: removed.map((entry) => entry.path) },
        "Removed skills this product installed under its old name",
      );
    }
  } catch (error) {
    args.logger.warn(
      { error: String(error) },
      "Could not prune skills installed under the old name",
    );
  }
}
