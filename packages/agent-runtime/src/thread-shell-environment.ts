import {
  deriveThreadApiKey,
  PATCHER_THREAD_KEY_ENV,
} from "@patcher/config/thread-api-key";
import type { AgentRuntimeShellEnvironment } from "./types.js";

interface ThreadShellEnvironmentArgs {
  environmentId: string;
  projectId?: string;
  threadStoragePath?: string;
  threadId: string;
}

interface BuildThreadShellEnvironmentArgs extends ThreadShellEnvironmentArgs {
  baseShellEnv: AgentRuntimeShellEnvironment | undefined;
}

/** What the daemon puts the app key in, for this module to trade away. */
const APP_KEY_ENV = "PATCHER_APP_KEY";

/**
 * Trade the app key for one that only speaks for this thread.
 *
 * The daemon resolves a single shell environment for every runtime it starts,
 * and the app key in it is the credential the app, the CLI and the launcher all
 * present — so handing it to a turn's processes made an agent
 * indistinguishable from the person at the machine, and left the thread it was
 * running in a header it could simply omit.
 *
 * The derived key names this thread and nothing else. An agent still reaches
 * the API through the `patcher` CLI exactly as before; what changes is that the
 * server can now charge it a policy, and that omitting the thread declaration
 * costs it the ability to call at all rather than promoting it to the app.
 *
 * A base environment with no app key stays that way: a daemon that could not
 * find one had nothing to hand over before either, and the CLI in that shell
 * reports the 401 it always did.
 */
export function buildThreadShellEnvironment(
  args: BuildThreadShellEnvironmentArgs,
): Record<string, string> {
  const { [APP_KEY_ENV]: appApiKey, ...baseShellEnv } = args.baseShellEnv ?? {};
  return {
    ...baseShellEnv,
    ...(appApiKey
      ? {
          [PATCHER_THREAD_KEY_ENV]: deriveThreadApiKey({
            appApiKey,
            threadId: args.threadId,
          }),
        }
      : {}),
    ...(args.projectId ? { PATCHER_PROJECT_ID: args.projectId } : {}),
    ...(args.threadStoragePath
      ? { PATCHER_THREAD_STORAGE: args.threadStoragePath }
      : {}),
    PATCHER_THREAD_ID: args.threadId,
    PATCHER_ENVIRONMENT_ID: args.environmentId,
  };
}
