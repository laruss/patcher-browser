/**
 * When agent shells rewrite PATH, a user-global or stale `patcher` may win over the
 * daemon-managed binary. The host daemon injects absolute `PATCHER_CLI` pointing at
 * that binary; official CLI entrypoints hop there once so bare `patcher` still works.
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/** Set on the re-exec child so a shell-script → node hop cannot loop. */
export const PATCHER_CLI_REEXEC_ENV = "PATCHER_CLI_REEXEC";

export interface MaybeReexecViaPatcherCliArgs {
  env?: NodeJS.ProcessEnv;
  /** Arguments after the node/script path (default: process.argv.slice(2)). */
  argv?: string[];
  /** Current CLI entry (default: process.argv[1]). */
  currentExecutablePath?: string;
  /**
   * Test seam: when provided, called instead of spawnSync + process.exit.
   * Must not return if it fully replaces the process.
   */
  reexec?: (args: {
    target: string;
    argv: string[];
    env: NodeJS.ProcessEnv;
  }) => void;
}

function tryRealpath(path: string): string | null {
  try {
    return realpathSync(resolve(path));
  } catch {
    return null;
  }
}

/**
 * If `PATCHER_CLI` names a different executable than the one currently running,
 * re-exec it with the same argv. No-op when unset, equal, missing, or already
 * in a re-exec hop.
 */
export function maybeReexecViaPatcherCli(
  options: MaybeReexecViaPatcherCliArgs = {},
): void {
  const env = options.env ?? process.env;
  if (env[PATCHER_CLI_REEXEC_ENV] === "1") {
    return;
  }

  const targetRaw = env.PATCHER_CLI?.trim();
  if (!targetRaw) {
    return;
  }

  const currentRaw = options.currentExecutablePath ?? process.argv[1];
  if (!currentRaw) {
    return;
  }

  const target = tryRealpath(targetRaw);
  const current = tryRealpath(currentRaw);
  if (target === null || current === null || target === current) {
    return;
  }

  const argv = options.argv ?? process.argv.slice(2);
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    [PATCHER_CLI_REEXEC_ENV]: "1",
  };

  if (options.reexec) {
    options.reexec({ target, argv, env: childEnv });
    return;
  }

  const result = spawnSync(target, argv, {
    env: childEnv,
    stdio: "inherit",
  });
  if (result.error) {
    process.stderr.write(
      `patcher: failed to re-exec PATCHER_CLI=${target}: ${result.error.message}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.exit(result.status === null ? 1 : result.status);
}
