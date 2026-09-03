import { afterEach, describe, expect, it } from "vitest";
import { listNonDeletedChildThreads } from "@patcher/db";
import { deriveThreadTurnApiKey } from "@patcher/config/thread-api-key";
import {
  PATCHER_THREAD_ID_HEADER,
  PATCHER_THREAD_KEY_HEADER,
} from "@patcher/server-contract";
import {
  agentParentThreadDenial,
  agentProjectDenial,
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
  appFetch,
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
 *
 * The `:id` was not the only way to name one, though. A creation body names a
 * parent — and a parent is sent a turn when its child finishes, so adopting a
 * Full Access thread is the same escalation with a delay — and both create and
 * update name a project, which is what the workspace check reads to decide
 * which folders a turn may point the next sandbox at.
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
  return {
    caller,
    child,
    grandchild,
    host,
    project,
    siblingOfCaller,
    stranger,
  };
}

/** A second project on the same machine, with a source of its own. */
function seedOtherProject(harness: TestAppHarness, hostId: string) {
  const { project } = seedProjectWithSource(harness.deps, {
    hostId,
    name: "Other Project",
    path: "/tmp/other-project",
  });
  return project;
}

function createThreadBody(
  hostId: string,
  projectId: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    origin: "app",
    projectId,
    providerId: "codex",
    input: [{ type: "text", text: "do this" }],
    environment: {
      type: "host",
      hostId,
      workspace: { type: "unmanaged", path: null },
    },
    ...extra,
  });
}

describe("targetThreadIdFromPath", () => {
  it("reads the thread a thread route acts on", () => {
    expect(targetThreadIdFromPath("/api/v1/threads/thr_1")).toBe("thr_1");
    expect(targetThreadIdFromPath("/api/v1/threads/thr_1/send")).toBe("thr_1");
    expect(
      targetThreadIdFromPath(
        "/api/v1/threads/thr_1/interactions/pint_2/cancel",
      ),
    ).toBe("thr_1");
  });

  it("is not fooled by a path that merely contains the word", () => {
    // The gate refuses what it does not recognise as in-scope, so a path read
    // as a thread route by accident would refuse a route nobody meant to scope.
    expect(
      targetThreadIdFromPath("/api/v1/environments/env_1/archive-threads"),
    ).toBeNull();
    expect(targetThreadIdFromPath("/api/v1/threads")).toBeNull();
    expect(
      targetThreadIdFromPath("/api/v1/projects/proj_1/threads"),
    ).toBeNull();
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

describe("agentParentThreadDenial", () => {
  it("lets a turn parent a thread on itself and on the ones it spawned", async () => {
    await withTestHarness(async (harness) => {
      const family = seedFamily(harness);

      for (const parent of [family.caller, family.child, family.grandchild]) {
        expect(
          agentParentThreadDenial(harness.deps.db, {
            callerThreadId: family.caller.id,
            parentThreadId: parent.id,
          }),
        ).toBeNull();
      }
    });
  });

  it("refuses a parent it did not spawn, and names it", async () => {
    await withTestHarness(async (harness) => {
      const family = seedFamily(harness);

      for (const parent of [family.stranger, family.siblingOfCaller]) {
        const denial = agentParentThreadDenial(harness.deps.db, {
          callerThreadId: family.caller.id,
          parentThreadId: parent.id,
        });
        expect(denial).toContain(parent.id);
        expect(denial).toContain("not this turn's to parent");
      }
    });
  });
});

describe("agentProjectDenial", () => {
  it("lets a turn work in the project its own thread belongs to", async () => {
    await withTestHarness(async (harness) => {
      const family = seedFamily(harness);

      expect(
        agentProjectDenial(harness.deps.db, {
          callerThreadId: family.caller.id,
          projectId: family.project.id,
        }),
      ).toBeNull();
    });
  });

  it("refuses another project, and says which one is this turn's", async () => {
    await withTestHarness(async (harness) => {
      const family = seedFamily(harness);
      const other = seedOtherProject(harness, family.host.id);

      const denial = agentProjectDenial(harness.deps.db, {
        callerThreadId: family.caller.id,
        projectId: other.id,
      });
      expect(denial).toContain(other.id);
      expect(denial).toContain(family.project.id);
    });
  });

  it("refuses a caller with no thread of its own", async () => {
    // Cannot happen while the key is verified against a live thread, and the
    // answer still has to be "no" rather than "no project to compare with".
    await withTestHarness(async (harness) => {
      const family = seedFamily(harness);

      expect(
        agentProjectDenial(harness.deps.db, {
          callerThreadId: "thr_not_there",
          projectId: family.project.id,
        }),
      ).toContain("not this turn's to start a thread in");
    });
  });
});

describe("a turn creating a thread, at the HTTP boundary", () => {
  it("cannot hang the new thread under a thread it did not spawn", async () => {
    // The escalation this closes: when the child's turn ends, the parent is
    // sent a turn carrying the child's output, at the parent's own permission
    // mode. Adoption is `send` with a delay.
    server = await startTestServer();
    const family = seedFamily(server);

    const response = await fetch(`${server.baseUrl}/api/v1/threads`, {
      method: "POST",
      headers: agentHeaders(family.caller.id),
      body: createThreadBody(family.host.id, family.project.id, {
        parentThreadId: family.stranger.id,
      }),
    });

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain(family.stranger.id);
    expect(body).toContain("not this turn's to parent");
    // "Nothing changed" is part of what the refusal says, so it is asserted:
    // the stranger keeps the one child it was seeded with.
    expect(
      listNonDeletedChildThreads(server.deps.db, {
        parentThreadId: family.stranger.id,
      }),
    ).toHaveLength(1);
  });

  it("cannot re-parent a thread of its own onto a stranger", async () => {
    // The same adoption through the other door: the `:id` gate passes, because
    // the thread being patched really is the caller's.
    server = await startTestServer();
    const family = seedFamily(server);

    const response = await fetch(
      `${server.baseUrl}/api/v1/threads/${family.child.id}`,
      {
        method: "PATCH",
        headers: agentHeaders(family.caller.id),
        body: JSON.stringify({ parentThreadId: family.stranger.id }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("not this turn's to parent");
  });

  it("cannot start a thread in another project", async () => {
    server = await startTestServer();
    const family = seedFamily(server);
    const other = seedOtherProject(server, family.host.id);

    const response = await fetch(`${server.baseUrl}/api/v1/threads`, {
      method: "POST",
      headers: agentHeaders(family.caller.id),
      body: createThreadBody(family.host.id, other.id),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain(
      "not this turn's to start a thread in",
    );
  });

  it("is not refused by these gates spawning a child of its own", async () => {
    server = await startTestServer();
    const family = seedFamily(server);

    const response = await fetch(`${server.baseUrl}/api/v1/threads`, {
      method: "POST",
      headers: agentHeaders(family.caller.id),
      body: createThreadBody(family.host.id, family.project.id, {
        parentThreadId: family.caller.id,
      }),
    });

    // The thread is really created and really hangs where it was asked to:
    // an assertion that the refusal is merely absent would pass just as well
    // on a request that failed for some other reason.
    expect(response.status).toBe(201);
    expect(
      ((await response.json()) as { parentThreadId: string }).parentThreadId,
    ).toBe(family.caller.id);
  });

  it("leaves a person creating a thread anywhere alone", async () => {
    // The same split as every other turn-vs-person check here: whoever is at
    // the machine picks the project and the parent.
    server = await startTestServer();
    const family = seedFamily(server);

    const response = await appFetch(`${server.baseUrl}/api/v1/threads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: createThreadBody(family.host.id, family.project.id, {
        parentThreadId: family.stranger.id,
      }),
    });

    expect(response.status).toBe(201);
    expect(
      ((await response.json()) as { parentThreadId: string }).parentThreadId,
    ).toBe(family.stranger.id);
  });
});
