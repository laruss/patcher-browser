import { describe, expect, it } from "vitest";
import {
  deriveTerminalApiKey,
  deriveThreadTurnApiKey,
} from "@patcher/config/thread-api-key";
import { createTerminalSession, updateTerminalSession } from "@patcher/db";
import {
  PATCHER_THREAD_ID_HEADER,
  PATCHER_THREAD_KEY_HEADER,
} from "@patcher/server-contract";
import { createThreadApiIdentity } from "../../src/thread-identity.js";
import {
  seedEnvironment,
  seedHost,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

/** A terminal that is open, which is the lifetime its credential rides on. */
function seedOpenTerminal(
  harness: TestAppHarness,
  args: { environmentId: string; hostId: string; threadId: string },
) {
  return createTerminalSession(harness.deps.db, {
    cols: 100,
    rows: 30,
    daemonSessionId: null,
    environmentId: args.environmentId,
    hostId: args.hostId,
    initialCwd: "/tmp/credential-lifetime",
    sandboxed: true,
    status: "running",
    threadId: args.threadId,
    title: "Terminal",
  });
}

/**
 * How long a thread's credential is good for.
 *
 * There are two, because there are two lifetimes. A turn's processes get one
 * that lasts as long as the turn: what an agent saves from its shell stops
 * working when that turn ends, which is the window it used to keep. A terminal
 * gets one that lasts as long as the terminal, because that is the thing which
 * legitimately outlives a turn — and unlike a saved string, it is something a
 * person can see and close.
 *
 * Neither lifetime is a deadline. Both are state the server already keeps, so
 * none of this needs a store of live keys or a refresh path — the questions are
 * "is the turn still running" and "is the terminal still open".
 */

const APP_KEY = "app-key-for-thread-credential-lifetime";

function carrier(headers: Record<string, string>) {
  return { header: (name: string) => headers[name] };
}

function identityFor(harness: TestAppHarness) {
  return createThreadApiIdentity({ appApiKey: APP_KEY, db: harness.deps.db });
}

function seedThreadWithStatus(
  harness: TestAppHarness,
  status: "idle" | "active" | "stopping" | "error",
) {
  const host = seedHost(harness.deps, { id: `host-${status}` });
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status,
  });
  return { environment, host, project, thread };
}

describe("a turn's credential", () => {
  it("is the thread's caller while its turn is running", async () => {
    await withTestHarness(async (harness) => {
      for (const status of ["starting", "active", "stopping"] as const) {
        const host = seedHost(harness.deps, { id: `host-live-${status}` });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          status,
        });

        expect(
          identityFor(harness).resolve(
            carrier({
              [PATCHER_THREAD_ID_HEADER]: thread.id,
              [PATCHER_THREAD_KEY_HEADER]: deriveThreadTurnApiKey({
                appApiKey: APP_KEY,
                threadId: thread.id,
              }),
            }),
          ),
          `a thread that is ${status} has a turn to speak for`,
        ).toBe(thread.id);
      }
    });
  });

  it("is nobody once the turn is over", async () => {
    await withTestHarness(async (harness) => {
      // The gap this closes: the key verifies exactly as it did a second ago,
      // and it is the same string the agent was handed. What changed is that
      // the turn it was given for has ended.
      const { thread } = seedThreadWithStatus(harness, "idle");

      expect(
        identityFor(harness).resolve(
          carrier({
            [PATCHER_THREAD_ID_HEADER]: thread.id,
            [PATCHER_THREAD_KEY_HEADER]: deriveThreadTurnApiKey({
              appApiKey: APP_KEY,
              threadId: thread.id,
            }),
          }),
        ),
      ).toBeNull();
    });
  });

  it("is nobody for a thread that errored, or one that is gone", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadWithStatus(harness, "error");
      const identity = identityFor(harness);

      expect(
        identity.resolve(
          carrier({
            [PATCHER_THREAD_ID_HEADER]: thread.id,
            [PATCHER_THREAD_KEY_HEADER]: deriveThreadTurnApiKey({
              appApiKey: APP_KEY,
              threadId: thread.id,
            }),
          }),
        ),
      ).toBeNull();

      // A key for a thread that never existed verifies against the app key
      // just as well, which is why the lookup is not an optimisation.
      expect(
        identity.resolve(
          carrier({
            [PATCHER_THREAD_ID_HEADER]: "thr-never-existed",
            [PATCHER_THREAD_KEY_HEADER]: deriveThreadTurnApiKey({
              appApiKey: APP_KEY,
              threadId: "thr-never-existed",
            }),
          }),
        ),
      ).toBeNull();
    });
  });
});

describe("a terminal's credential", () => {
  it("is the thread's caller while the terminal is open", async () => {
    await withTestHarness(async (harness) => {
      const { environment, host, thread } = seedThreadWithStatus(
        harness,
        "idle",
      );
      const terminal = seedOpenTerminal(harness, {
        environmentId: environment.id,
        hostId: host.id,
        threadId: thread.id,
      });

      // The thread is idle on purpose: a terminal is exactly the caller that
      // outlives a turn, so its credential cannot depend on one running.
      expect(
        identityFor(harness).resolve(
          carrier({
            [PATCHER_THREAD_ID_HEADER]: thread.id,
            [PATCHER_THREAD_KEY_HEADER]: deriveTerminalApiKey({
              appApiKey: APP_KEY,
              threadId: thread.id,
              terminalId: terminal.id,
            }),
          }),
        ),
      ).toBe(thread.id);
    });
  });

  it("is nobody once the terminal has closed", async () => {
    await withTestHarness(async (harness) => {
      const { environment, host, thread } = seedThreadWithStatus(
        harness,
        "active",
      );
      const terminal = seedOpenTerminal(harness, {
        environmentId: environment.id,
        hostId: host.id,
        threadId: thread.id,
      });
      updateTerminalSession(harness.deps.db, {
        scope: { kind: "terminal", terminalId: terminal.id },
        update: { kind: "exit", closeReason: "process-exit" },
      });

      // The thread is mid-turn, so this is the terminal's own lifetime being
      // enforced rather than the thread's standing in for it.
      expect(
        identityFor(harness).resolve(
          carrier({
            [PATCHER_THREAD_ID_HEADER]: thread.id,
            [PATCHER_THREAD_KEY_HEADER]: deriveTerminalApiKey({
              appApiKey: APP_KEY,
              threadId: thread.id,
              terminalId: terminal.id,
            }),
          }),
        ),
      ).toBeNull();
    });
  });

  it("cannot be presented for a terminal that belongs to another thread", async () => {
    await withTestHarness(async (harness) => {
      const mine = seedThreadWithStatus(harness, "active");
      const theirs = seedThreadWithStatus(harness, "active");
      const theirTerminal = seedOpenTerminal(harness, {
        environmentId: theirs.environment.id,
        hostId: theirs.host.id,
        threadId: theirs.thread.id,
      });

      // Two ways to try it, and the MAC closes the first while the row check
      // closes the second: sign for my own thread and name their terminal, or
      // present their terminal's genuine key under my own thread id.
      const identity = identityFor(harness);
      expect(
        identity.resolve(
          carrier({
            [PATCHER_THREAD_ID_HEADER]: mine.thread.id,
            [PATCHER_THREAD_KEY_HEADER]: deriveTerminalApiKey({
              appApiKey: APP_KEY,
              threadId: mine.thread.id,
              terminalId: theirTerminal.id,
            }),
          }),
        ),
      ).toBeNull();
      expect(
        identity.resolve(
          carrier({
            [PATCHER_THREAD_ID_HEADER]: mine.thread.id,
            [PATCHER_THREAD_KEY_HEADER]: deriveTerminalApiKey({
              appApiKey: APP_KEY,
              threadId: theirs.thread.id,
              terminalId: theirTerminal.id,
            }),
          }),
        ),
      ).toBeNull();
    });
  });
});

describe("what neither credential is", () => {
  it("is nobody without the key, so an agent cannot drop the declaration", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadWithStatus(harness, "active");

      expect(
        identityFor(harness).resolve(
          carrier({ [PATCHER_THREAD_ID_HEADER]: thread.id }),
        ),
      ).toBeNull();
    });
  });

  it("is nobody when the key does not match the declared thread", async () => {
    await withTestHarness(async (harness) => {
      const mine = seedThreadWithStatus(harness, "active");
      const theirs = seedThreadWithStatus(harness, "active");

      expect(
        identityFor(harness).resolve(
          carrier({
            [PATCHER_THREAD_ID_HEADER]: mine.thread.id,
            [PATCHER_THREAD_KEY_HEADER]: deriveThreadTurnApiKey({
              appApiKey: APP_KEY,
              threadId: theirs.thread.id,
            }),
          }),
        ),
      ).toBeNull();
    });
  });

  it("is nobody for a caller presenting the app key, or an unshaped one", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadWithStatus(harness, "active");
      const identity = identityFor(harness);

      for (const presented of [
        APP_KEY,
        // The v1 shape: a bare digest with no kind in it. Refused rather than
        // guessed at, which is what the protocol bump is for.
        "hkKmhz4kJUKUP0G1r1WsnRs0lRSZuHYq1Rr1Zt-6Rio",
        "pt2.",
        "px2.only-one-part",
      ]) {
        expect(
          identity.resolve(
            carrier({
              [PATCHER_THREAD_ID_HEADER]: thread.id,
              [PATCHER_THREAD_KEY_HEADER]: presented,
            }),
          ),
          presented,
        ).toBeNull();
      }
    });
  });

  it("is nobody for a request carrying neither header", async () => {
    await withTestHarness(async (harness) => {
      expect(identityFor(harness).resolve(carrier({}))).toBeNull();
    });
  });
});
