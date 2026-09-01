import path from "node:path";
import type { WrapAcpAgentLaunchResult } from "@patcher/agent-runtime";
import { buildTerminalSandboxLauncher } from "./terminals/terminal-sandbox.js";

/**
 * Running an ACP provider's own process inside the turn's boundary.
 *
 * ACP has no sandbox of its own. Its `accept-edits` is a path check on
 * `fs/write_text_file` in the bridge, and the agent's *own shell* is not held to
 * it — measured on Cursor with a real turn: unconfined, `printf hi > ~/probe`
 * from the agent's shell wrote the file; confined by this, the same command was
 * refused while `printf hi > <workspace>/hello.txt` still worked.
 *
 * The sandbox is the one Patcher already builds for terminals, and that is the
 * point rather than a shortcut: it confines the filesystem and leaves the
 * network alone, which is exactly the half these providers have open. An egress
 * proxy is the other half and is not needed for this one.
 *
 * Two things the policy has to add beyond a terminal's:
 *
 * - **The provider's own state directories.** It cannot start without them:
 *   `cursor-agent acp` answers `session/new` with
 *   `EPERM … ~/.cursor/cli-config.json.tmp` until `.cursor` is writable, and
 *   creates the session once it is. Which directories those are is each
 *   profile's to declare, so a new provider says so rather than being
 *   discovered by a failure in production.
 * - **Nothing else.** The workspace, the git roots beside it, the read-only
 *   repository files and the denied credential files are the same list the
 *   turn's own sandbox is built from, because a provider that could reach past
 *   them would be a second boundary disagreeing with the first.
 *
 * What crosses back to the runtime is a launcher, not a finished command: the
 * bridge appends the agent's own model and permission flags, and a launcher
 * folded into the command would have collected them itself.
 */

export interface AcpAgentSandboxArgs {
  /** The turn's working directory, and the writable root. */
  cwd: string;
  /** `$HOME`-relative directories from the provider's profile. */
  stateDirs: readonly string[];
  /** `$HOME`, or undefined where the environment has none. */
  homeDirectory: string | undefined;
  additionalWorkspaceWriteRoots: readonly string[];
  protectedRepositoryPaths: readonly string[];
  protectedCredentialPaths: readonly string[];
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

export function buildAcpAgentSandboxLauncher(
  args: AcpAgentSandboxArgs,
): WrapAcpAgentLaunchResult {
  const homeDirectory = args.homeDirectory;
  if (homeDirectory === undefined && args.stateDirs.length > 0) {
    // Granting nothing instead would build a sandbox the provider cannot start
    // in, and the failure would arrive as the agent's own EPERM rather than as
    // an answer from Patcher.
    return {
      sandboxed: false,
      reason: `this daemon has no HOME, so the provider's own state directories (${args.stateDirs.join(", ")}) cannot be resolved`,
      remedy: "start the Patcher daemon with HOME set",
    };
  }
  const stateDirs =
    homeDirectory === undefined
      ? []
      : args.stateDirs.map((dir) => path.join(homeDirectory, dir));
  const built = buildTerminalSandboxLauncher({
    cwd: args.cwd,
    env: args.env,
    platform: args.platform,
    policy: {
      workspacePath: args.cwd,
      writableRoots: [...args.additionalWorkspaceWriteRoots, ...stateDirs],
      readOnlyPaths: args.protectedRepositoryPaths,
      deniedReadPaths: args.protectedCredentialPaths,
    },
  });
  return built.sandboxed
    ? {
        sandboxed: true,
        launcher: {
          command: built.launcher.file,
          args: [...built.launcher.args],
        },
      }
    : { sandboxed: false, reason: built.reason, remedy: built.remedy };
}
