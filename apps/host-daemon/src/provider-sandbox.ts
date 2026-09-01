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
 * point rather than a shortcut: the same policy, path for path. The network is
 * the half a terminal deliberately leaves open, and a provider process can ask
 * for it too — `egress` below routes everything that leaves the machine through
 * the proxy in `egress-proxy.ts`, and refuses the rest. Off unless the turn asks
 * for it, and only for a provider that has declared which hosts it needs.
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
  /**
   * Where this launch's only way out of the machine listens, when the turn
   * confines egress. Absent leaves the network alone, exactly as before.
   */
  egress?: { proxyUrl: string };
}

/**
 * What a confined process needs in its environment to find the proxy.
 *
 * Every client measured through it honors these — curl, git, npm, pip, and
 * cursor-agent, grok, hermes and opencode's own HTTP clients. Two of them are
 * worth a line each:
 *
 * - `NO_PROXY` is not politeness. Without it an agent routes its *own* internal
 *   loopback through Patcher's proxy: measured on opencode, whose UI talks to
 *   its own server and arrived here as `GET 127.0.0.1:4096`.
 * - `NODE_USE_ENV_PROXY` is what makes a Node-based agent use the proxy at all.
 *   Node's own clients ignore `HTTPS_PROXY`: measured, both `fetch` and
 *   `https.get` answer ENOTFOUND with it set. The flag fixes both on Node 24 and
 *   later and is ignored by earlier versions, so it is safe to always set and
 *   never enough to rely on — a library that implements proxying itself (npm
 *   does) works either way, and one that does not needs a new enough Node.
 */
function egressProxyEnv(proxyUrl: string): Record<string, string> {
  return {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    NO_PROXY: "localhost,127.0.0.1,::1",
    no_proxy: "localhost,127.0.0.1,::1",
    NODE_USE_ENV_PROXY: "1",
  };
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
      ...(args.egress !== undefined ? { egressConfined: true } : {}),
    },
  });
  return built.sandboxed
    ? {
        sandboxed: true,
        launcher: {
          command: built.launcher.file,
          args: [...built.launcher.args],
        },
        ...(args.egress !== undefined
          ? { env: egressProxyEnv(args.egress.proxyUrl) }
          : {}),
      }
    : { sandboxed: false, reason: built.reason, remedy: built.remedy };
}
