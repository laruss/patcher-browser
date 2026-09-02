import { describe, expect, it } from "vitest";
import {
  deriveThreadTurnApiKey,
  PATCHER_THREAD_KEY_ENV,
} from "@patcher/config/thread-api-key";
import { buildThreadShellEnvironment } from "./thread-shell-environment.js";

/**
 * What a turn's processes are handed, and — the part worth a test of its own —
 * what they are not.
 *
 * Every route policy on the server side rests on an agent holding a credential
 * that names its thread instead of the app key. If the app key ever comes back
 * into this environment, none of that fails loudly: the CLI would simply be the
 * app again, and the policy it is charged would stop applying. So the absence is
 * asserted here rather than inferred from the presence of the other one.
 */

const APP_KEY = "app-key-in-the-daemon-shell-env";

function baseShellEnv(): Record<string, string> {
  return {
    PATH: "/usr/bin",
    PATCHER_APP_KEY: APP_KEY,
    PATCHER_CLI: "/opt/patcher/bin/patcher",
    PATCHER_SERVER_URL: "http://127.0.0.1:38986",
  };
}

describe("buildThreadShellEnvironment", () => {
  it("does not hand the app key to a turn's processes", () => {
    const env = buildThreadShellEnvironment({
      baseShellEnv: baseShellEnv(),
      environmentId: "env-1",
      threadId: "thr-1",
    });

    expect(env).not.toHaveProperty("PATCHER_APP_KEY");
    expect(Object.values(env)).not.toContain(APP_KEY);
  });

  it("hands over the key derived for this thread instead", () => {
    const env = buildThreadShellEnvironment({
      baseShellEnv: baseShellEnv(),
      environmentId: "env-1",
      threadId: "thr-1",
    });

    expect(env[PATCHER_THREAD_KEY_ENV]).toBe(
      deriveThreadTurnApiKey({ appApiKey: APP_KEY, threadId: "thr-1" }),
    );
  });

  it("gives two threads keys that are no use to each other", () => {
    const first = buildThreadShellEnvironment({
      baseShellEnv: baseShellEnv(),
      environmentId: "env-1",
      threadId: "thr-1",
    });
    const second = buildThreadShellEnvironment({
      baseShellEnv: baseShellEnv(),
      environmentId: "env-1",
      threadId: "thr-2",
    });

    expect(first[PATCHER_THREAD_KEY_ENV]).not.toBe(
      second[PATCHER_THREAD_KEY_ENV],
    );
  });

  it("keeps the rest of the shell environment intact", () => {
    const env = buildThreadShellEnvironment({
      baseShellEnv: baseShellEnv(),
      environmentId: "env-1",
      projectId: "proj-1",
      threadStoragePath: "/data/thread-storage/thr-1",
      threadId: "thr-1",
    });

    expect(env).toMatchObject({
      PATH: "/usr/bin",
      PATCHER_CLI: "/opt/patcher/bin/patcher",
      PATCHER_SERVER_URL: "http://127.0.0.1:38986",
      PATCHER_PROJECT_ID: "proj-1",
      PATCHER_THREAD_STORAGE: "/data/thread-storage/thr-1",
      PATCHER_THREAD_ID: "thr-1",
      PATCHER_ENVIRONMENT_ID: "env-1",
    });
  });

  it("hands over no key at all when the daemon found none", () => {
    // A daemon on another machine from the server may have no key to read. It
    // had nothing to give before either, and the honest result is a shell whose
    // CLI is refused — not one holding a key derived from an empty secret.
    const env = buildThreadShellEnvironment({
      baseShellEnv: { PATH: "/usr/bin" },
      environmentId: "env-1",
      threadId: "thr-1",
    });

    expect(env).not.toHaveProperty(PATCHER_THREAD_KEY_ENV);
    expect(env).not.toHaveProperty("PATCHER_APP_KEY");
  });
});
