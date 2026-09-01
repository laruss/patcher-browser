import path from "node:path";
import type { WrapAcpAgentLaunchResult } from "@patcher/agent-runtime";
import { buildTerminalSandboxLauncher } from "./terminals/terminal-sandbox.js";

/**
 * Running a provider's own process inside the turn's boundary.
 *
 * Two providers arrive here, for the same reason and at different processes.
 *
 * ACP has no sandbox of its own. Its `accept-edits` is a path check on
 * `fs/write_text_file` in the bridge, and the agent's *own shell* is not held to
 * it — measured on Cursor with a real turn: unconfined, `printf hi > ~/probe`
 * from the agent's shell wrote the file; confined by this, the same command was
 * refused while `printf hi > <workspace>/hello.txt` still worked. There the
 * launcher goes in front of the agent, which is a child of its bridge.
 *
 * Pi has no sandbox and no permission system at all — its own documentation
 * says so — and its tools run *inside* Patcher's bridge rather than in a child
 * of it, so there the launcher goes in front of the bridge itself. Measured
 * under this profile: an in-process `fs` write inside the workspace succeeds,
 * the same write to `$HOME` is `EPERM`, and a child of that process is refused
 * it too, so one launcher holds Pi's edit tools and its bash tool alike.
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
 *   discovered by a failure in production. Pi's bridge declares its own in
 *   `pi/bridge-sandbox.ts`, where the same measurement is recorded.
 * - **Nothing else.** The workspace, the git roots beside it, the read-only
 *   repository files and the denied credential files are the same list the
 *   turn's own sandbox is built from, because a provider that could reach past
 *   them would be a second boundary disagreeing with the first.
 *
 * What crosses back to the runtime is a launcher, not a finished command: the
 * ACP bridge appends the agent's own model and permission flags, and a launcher
 * folded into the command would have collected them itself. The Pi path needs
 * the same shape for a different reason — the command it goes in front of is
 * the bridge the runtime is about to spawn, which this module never sees.
 */

export interface ProviderSandboxArgs {
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

export function buildProviderSandboxLauncher(
  args: ProviderSandboxArgs,
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
