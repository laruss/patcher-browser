import { afterEach, describe, expect, it } from "vitest";
import { deriveThreadTurnApiKey } from "@patcher/config/thread-api-key";
import {
  PATCHER_THREAD_ID_HEADER,
  PATCHER_THREAD_KEY_HEADER,
} from "@patcher/server-contract";
import {
  agentThreadScopeDenial,
  targetThreadIdFromPath,
} from "../../src/agent-thread-scope.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import {
  startTestServer,
  withTestHarness,
  TEST_APP_API_KEY,
  type RunningTestServer,
  type TestAppHarness,
} from "../helpers/test-app.js";

/**
 * A turn's agent may act on its own thread and on the threads it spawned.
 *
 * The thread key proves which thread is calling; until this gate, nothing
 * compared that with the thread the request acts on, so a sandboxed turn could
 * drive any other thread on the install — including one running at Full Access.
 */

let server: RunningTestServer | null = null;

afterEach(async () => {
  if (server !== null) {
    await server.close();
    server = null;
  }
});

function agentHeaders(threadId: string): Record<string, string> {
  return {
    [PATCHER_THREAD_ID_HEADER]: threadId,
    [PATCHER_THREAD_KEY_HEADER]: deriveThreadTurnApiKey({
      appApiKey: TEST_APP_API_KEY,
      threadId,
    }),
    "content-type": "application/json",
  };
}

function seedFamily(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps, { id: "host-thread-scope" });
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const seed = (parentThreadId: string | null) =>
    seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      parentThreadId,
    });
  // Mid-turn, because that is what a turn credential is accepted for now: an
  // idle caller would be refused before this file's scope rules were reached.
  const caller = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    parentThreadId: null,
    status: "active",
  });
  const child = seed(caller.id);
  const grandchild = seed(child.id);
  const stranger = seed(null);
  const siblingOfCaller = seed(stranger.id);
  return { caller, child, grandchild, siblingOfCaller, stranger };
}

describe("targetThreadIdFromPath", () => {
  it("reads the thread a thread route acts on", () => {
    expect(targetThreadIdFromPath("/api/v1/threads/thr_1")).toBe("thr_1");
    expect(targetThreadIdFromPath("/api/v1/threads/thr_1/send")).toBe("thr_1");
    expect(
      targetThreadIdFromPath("/api/v1/threads/thr_1/interactions/pint_2/cancel"),
    ).toBe("thr_1");
  });

  it("is not fooled by a path that merely contains the word", () => {
    // The gate refuses what it does not recognise as in-scope, so a path read
    // as a thread route by accident would refuse a route nobody meant to scope.
    expect(
      targetThreadIdFromPath("/api/v1/environments/env_1/archive-threads"),
    ).toBeNull();
    expect(targetThreadIdFromPath("/api/v1/threads")).toBeNull();
    expect(targetThreadIdFromPath("/api/v1/projects/proj_1/threads")).toBeNull();
  });
});

describe("agentThreadScopeDenial", () => {
  it("lets a turn act on its own thread and on the ones it spawned", async () => {
    await withTestHarness(async (harness) => {
      const family = seedFamily(harness);

      for (const target of [family.caller, family.child, family.grandchild]) {
        expect(
          agentThreadScopeDenial(harness.deps.db, {
            callerThreadId: family.caller.id,
            method: "POST",
            path: `/api/v1/threads/${target.id}/send`,
          }),
        ).toBeNull();
      }
    });
  });

  it("refuses a thread it did not spawn, however close", async () => {
    await withTestHarness(async (harness) => {
      const family = seedFamily(harness);

      for (const target of [family.stranger, family.siblingOfCaller]) {
        const denial = agentThreadScopeDenial(harness.deps.db, {
          callerThreadId: family.caller.id,
          method: "POST",
          path: `/api/v1/threads/${target.id}/send`,
        });
        expect(denial?.targetThreadId).toBe(target.id);
        expect(denial?.message).toContain("not this turn's to drive");
      }
    });
  });

  it("does not scope reads", async () => {
    await withTestHarness(async (harness) => {
      const family = seedFamily(harness);

      expect(
        agentThreadScopeDenial(harness.deps.db, {
          callerThreadId: family.caller.id,
          method: "GET",
          path: `/api/v1/threads/${family.stranger.id}`,
        }),
      ).toBeNull();
    });
  });
});

describe("an agent at the HTTP boundary", () => {
  it("cannot send to a thread it did not spawn", async () => {
    server = await startTestServer();
    const family = seedFamily(server);

    const response = await fetch(
      `${server.baseUrl}/api/v1/threads/${family.stranger.id}/send`,
      {
        method: "POST",
        headers: agentHeaders(family.caller.id),
        body: JSON.stringify({ input: [{ type: "text", text: "do this" }] }),
      },
    );

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain(family.stranger.id);
    expect(body).toContain("not this turn's to drive");
  });

  it("is not refused by this gate on its own thread", async () => {
    server = await startTestServer();
    const family = seedFamily(server);

    const response = await fetch(
      `${server.baseUrl}/api/v1/threads/${family.caller.id}/send`,
      {
        method: "POST",
        headers: agentHeaders(family.caller.id),
        body: JSON.stringify({ input: [{ type: "text", text: "do this" }] }),
      },
    );

    // What happens next is the send route's business — this asserts only that
    // the scope gate is not what stopped it.
    expect(await response.text()).not.toContain("not this turn's to drive");
  });
});
