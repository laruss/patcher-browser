import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentRoutePolicyDenial } from "../../src/agent-route-policy.js";
import { deriveThreadTurnApiKey } from "@patcher/config/thread-api-key";
import { PATCHER_APP_KEY_HEADER } from "@patcher/config/app-key";
import { defaultAppSettings, type AppSettings } from "@patcher/domain";
import {
  PATCHER_THREAD_ID_HEADER,
  PATCHER_THREAD_KEY_HEADER,
} from "@patcher/server-contract";
import type { AppDeps } from "../../src/types.js";
import {
  seedHost,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import {
  createTestAppHarness,
  startTestServer,
  TEST_APP_API_KEY,
  type RunningTestServer,
  type TestAppHarness,
} from "../helpers/test-app.js";

/** The methods this policy treats as writes, matching the module's own list. */
const MUTATION_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

let server: RunningTestServer | null = null;

afterEach(async () => {
  if (server !== null) {
    await server.close();
    server = null;
  }
});

/**
 * A thread with a turn running, which is what these callers claim to be.
 *
 * A turn credential is accepted only while its thread has a live turn, so a
 * made-up thread id no longer stands in for one: the identity now reads the
 * thread's own status. Seeding it is the fixture catching up with what the
 * describe block below has always said it was testing.
 */
function seedThreadMidTurn(deps: Pick<AppDeps, "db" | "hub">): string {
  const host = seedHost(deps, { id: "host-agent-policy" });
  const { project } = seedProjectWithSource(deps, { hostId: host.id });
  return seedThread(deps, { projectId: project.id, status: "active" }).id;
}

/** The same `PUT`, sent as the person at the machine rather than as a turn. */
function appPut(settings: AppSettings): RequestInit {
  return {
    method: "PUT",
    headers: {
      [PATCHER_APP_KEY_HEADER]: TEST_APP_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify(settings),
  };
}

/** The headers a turn's `patcher` CLI sends: its thread, and no app key. */
function agentHeaders(threadId = "thr-agent-1"): Record<string, string> {
  return {
    [PATCHER_THREAD_ID_HEADER]: threadId,
    [PATCHER_THREAD_KEY_HEADER]: deriveThreadTurnApiKey({
      appApiKey: TEST_APP_API_KEY,
      threadId,
    }),
    "content-type": "application/json",
  };
}

describe("agentRoutePolicyDenial", () => {
  it("refuses the file mutations that write outside the workspace", () => {
    for (const path of [
      "/api/v1/files/write",
      "/api/v1/files/mkdir",
      "/api/v1/files/move",
      "/api/v1/files/remove",
    ]) {
      expect(agentRoutePolicyDenial({ method: "POST", path })).not.toBeNull();
    }
  });

  it("no longer refuses a terminal by route, because the terminal changed", () => {
    // A terminal an agent opens runs inside the boundary its turn runs in, so
    // this policy has nothing to say about it. Which terminal, and whether it
    // is confined at all, is `agent-terminal-scope.ts` — the route shape cannot
    // tell those apart, and a blanket refusal here took the feature away.
    expect(
      agentRoutePolicyDenial({ method: "POST", path: "/api/v1/terminals" }),
    ).toBeNull();
    expect(
      agentRoutePolicyDenial({
        method: "POST",
        path: "/api/v1/terminals/term-1/input",
      }),
    ).toBeNull();
  });

  it("refuses raising the machine's permission ceiling", () => {
    expect(
      agentRoutePolicyDenial({
        method: "PATCH",
        path: "/api/v1/hosts/host-1/permission-ceiling",
      }),
    ).not.toBeNull();
  });

  it("refuses the other host routes that reach outside the sandbox", () => {
    expect(
      agentRoutePolicyDenial({
        method: "POST",
        path: "/api/v1/hosts/host-1/provider-clis/install",
      }),
    ).not.toBeNull();
    expect(
      agentRoutePolicyDenial({
        method: "POST",
        path: "/api/v1/hosts/join-codes",
      }),
    ).not.toBeNull();
  });

  it("refuses answering a setup-script question, and leaves reading one open", () => {
    // The consent prompt is refused inside a turn where it is raised; this route
    // is the same answer given later, from the project's settings. A turn that
    // could give it would be allowing its own committed script to run on the
    // host, outside the sandbox, as the user.
    const denial = agentRoutePolicyDenial({
      method: "POST",
      path: "/api/v1/projects/proj-1/setup-script-consents/escon-1/allow",
    });

    expect(denial?.route).toBe("/projects/:id/setup-script-consents");
    expect(denial?.message).toContain("outside this turn's sandbox");
    expect(
      agentRoutePolicyDenial({
        method: "DELETE",
        path: "/api/v1/projects/proj-1/setup-script-consents/escon-1",
      }),
    ).not.toBeNull();
    // Reading what is allowed is not answering anything.
    expect(
      agentRoutePolicyDenial({
        method: "GET",
        path: "/api/v1/projects/proj-1/setup-script-consents",
      }),
    ).toBeNull();
    // And the project routes beside it stay open.
    expect(
      agentRoutePolicyDenial({
        method: "PATCH",
        path: "/api/v1/projects/proj-1",
      }),
    ).toBeNull();
  });

  it("refuses writing the app-wide settings the next turn is built from", () => {
    // `/settings/general` carries the egress switch, the host list it answers
    // by, and `codexNetworkDisabled` — the boundary this turn is running
    // inside, read again when the next turn is built.
    for (const path of [
      "/api/v1/settings/general",
      "/api/v1/settings/keyboard",
      "/api/v1/settings/experiments",
      "/api/v1/settings/appearance",
    ]) {
      const denial = agentRoutePolicyDenial({ method: "PUT", path });

      expect(denial?.route).toBe("/settings");
      expect(denial?.message).toContain("confined to a list of hosts");
    }
    // Reading what it is running under is not writing it, here and on the
    // route that answers with the same object.
    expect(
      agentRoutePolicyDenial({
        method: "GET",
        path: "/api/v1/settings/themes",
      }),
    ).toBeNull();
    expect(
      agentRoutePolicyDenial({ method: "GET", path: "/api/v1/system/config" }),
    ).toBeNull();
    // A prefix is a segment, not a string.
    expect(
      agentRoutePolicyDenial({
        method: "PUT",
        path: "/api/v1/settings-registry",
      }),
    ).toBeNull();
  });

  it("leaves the rest of the hosts and threads routes alone", () => {
    expect(
      agentRoutePolicyDenial({ method: "PATCH", path: "/api/v1/hosts/host-1" }),
    ).toBeNull();
    expect(
      agentRoutePolicyDenial({ method: "GET", path: "/api/v1/hosts" }),
    ).toBeNull();
    expect(
      agentRoutePolicyDenial({
        method: "POST",
        path: "/api/v1/threads/thr-1/send",
      }),
    ).toBeNull();
  });

  it("leaves reads alone, including on a denied path", () => {
    expect(
      agentRoutePolicyDenial({ method: "GET", path: "/api/v1/files/list" }),
    ).toBeNull();
    expect(
      agentRoutePolicyDenial({ method: "GET", path: "/api/v1/terminals" }),
    ).toBeNull();
  });

  it("refuses the one read whose answer is a credential", () => {
    // The exception that says what leaving reads open actually rests on. A GET
    // on `/host-daemon-keys/:hostId` answers with what the app presents to a
    // machine's own daemon API, whose one executing route runs a command on the
    // host outside this turn's sandbox — so that credential is minted in memory
    // rather than read from the app key file, and handing it over on a read
    // would put it straight back.
    const denial = agentRoutePolicyDenial({
      method: "GET",
      path: "/api/v1/host-daemon-keys/host-1",
    });

    expect(denial?.route).toBe("/host-daemon-keys/:hostId");
    expect(denial?.message).toContain("outside this turn's sandbox");
    // And with every other method too, which is what makes it a different list.
    for (const method of ["POST", "DELETE"]) {
      expect(
        agentRoutePolicyDenial({
          method,
          path: "/api/v1/host-daemon-keys/host-1",
        }),
      ).not.toBeNull();
    }
    // A prefix collision is still not a match.
    expect(
      agentRoutePolicyDenial({
        method: "GET",
        path: "/api/v1/host-daemon-keyring",
      }),
    ).toBeNull();
  });

  it("leaves the work an agent is expected to do alone", () => {
    for (const path of [
      "/api/v1/files/read",
      "/api/v1/threads",
      "/api/v1/plugins/install",
      "/api/v1/projects",
    ]) {
      expect(agentRoutePolicyDenial({ method: "POST", path })).toBeNull();
    }
  });

  it("does not let a prefix collision deny an unrelated route", () => {
    expect(
      agentRoutePolicyDenial({
        method: "POST",
        path: "/api/v1/terminals-registry",
      }),
    ).toBeNull();
    expect(
      agentRoutePolicyDenial({ method: "POST", path: "/api/v1/files/writers" }),
    ).toBeNull();
  });

  it("names the route and the way to do it properly", () => {
    const denial = agentRoutePolicyDenial({
      method: "POST",
      path: "/api/v1/files/write",
    });

    expect(denial?.route).toBe("/files/write");
    expect(denial?.message).toContain("workspace sandbox");
    expect(denial?.message).toContain("Ask the person in the thread");
  });
});

/**
 * Over a real socket with a plain `fetch`, deliberately: `harness.app` adds the
 * app key, and the whole point of these is a caller that has none.
 */
describe("an agent mid-turn", () => {
  it("reaches the API with only its thread key", async () => {
    server = await startTestServer();

    const response = await fetch(`${server.baseUrl}/api/v1/projects`, {
      headers: agentHeaders(seedThreadMidTurn(server.deps)),
    });

    expect(response.status).toBe(200);
  });

  it("is refused a write to any path on the machine", async () => {
    server = await startTestServer();

    const response = await fetch(`${server.baseUrl}/api/v1/files/write`, {
      method: "POST",
      headers: agentHeaders(seedThreadMidTurn(server.deps)),
      body: JSON.stringify({ path: "/etc/patcher-escape", content: "x" }),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("workspace sandbox");
  });

  it("is refused a terminal that belongs to no turn", async () => {
    server = await startTestServer();

    // The route came back when the terminal changed, but only for a thread:
    // an environment names no turn to take the boundary from, and a host path
    // is the shell-anywhere case the boundary exists to close.
    for (const target of [
      { kind: "environment", environmentId: "env-1" },
      { kind: "host_path", hostId: "host-1", cwd: "/tmp" },
    ]) {
      const response = await fetch(`${server.baseUrl}/api/v1/terminals`, {
        method: "POST",
        headers: agentHeaders(seedThreadMidTurn(server.deps)),
        body: JSON.stringify({ cols: 100, rows: 30, target }),
      });

      expect(response.status).toBe(403);
      expect(await response.text()).toContain("opens a terminal for a thread");
    }
  });

  it("is refused a raise of its machine's permission ceiling", async () => {
    server = await startTestServer();

    const response = await fetch(
      `${server.baseUrl}/api/v1/hosts/host-1/permission-ceiling`,
      {
        method: "PATCH",
        headers: agentHeaders(seedThreadMidTurn(server.deps)),
        body: JSON.stringify({ maxPermissionMode: "full" }),
      },
    );

    expect(response.status).toBe(403);
  });

  it("is refused the network settings it would run the next turn under", async () => {
    server = await startTestServer();
    const threadId = seedThreadMidTurn(server.deps);

    // Confined first, by the person at the machine, so the flip below has
    // something to undo rather than a default to agree with.
    const confined = await fetch(
      `${server.baseUrl}/api/v1/settings/general`,
      appPut({ ...defaultAppSettings, providerEgressConfined: true }),
    );
    expect(confined.status).toBe(200);

    const response = await fetch(`${server.baseUrl}/api/v1/settings/general`, {
      method: "PUT",
      headers: agentHeaders(threadId),
      body: JSON.stringify({
        ...defaultAppSettings,
        providerEgressConfined: false,
        codexNetworkDisabled: false,
        providerEgressAllowedHosts: ["exfil.example.com"],
      }),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("confined to a list of hosts");
    // The refusal is worth nothing unless the row is unchanged: read it back
    // through the same route the next turn is built from.
    const config = await fetch(`${server.baseUrl}/api/v1/system/config`, {
      headers: agentHeaders(threadId),
    });
    const { generalSettings } = (await config.json()) as {
      generalSettings: AppSettings;
    };
    expect(generalSettings.providerEgressConfined).toBe(true);
    expect(generalSettings.providerEgressAllowedHosts).toEqual([]);
  });

  it("cannot drop its thread declaration to be taken for the app", async () => {
    server = await startTestServer();

    const response = await fetch(`${server.baseUrl}/api/v1/files/write`, {
      method: "POST",
      headers: {
        [PATCHER_THREAD_KEY_HEADER]: deriveThreadTurnApiKey({
          appApiKey: TEST_APP_API_KEY,
          threadId: "thr-agent-1",
        }),
        "content-type": "application/json",
      },
      body: JSON.stringify({ path: "/etc/patcher-escape", content: "x" }),
    });

    expect(response.status).toBe(401);
  });

  it("is still refused when it also presents an app key it found on disk", async () => {
    // The narrower identity wins: a caller that can prove which thread it is
    // gets charged that thread's policy, whatever else it attaches.
    server = await startTestServer();

    const response = await fetch(`${server.baseUrl}/api/v1/files/write`, {
      method: "POST",
      headers: {
        ...agentHeaders(seedThreadMidTurn(server.deps)),
        [PATCHER_APP_KEY_HEADER]: TEST_APP_API_KEY,
      },
      body: JSON.stringify({ path: "/etc/patcher-escape", content: "x" }),
    });

    expect(response.status).toBe(403);
  });

  it("does not stand in the way of the person at the machine", async () => {
    server = await startTestServer();

    // Reaches the handler, which then answers on the request's own merits —
    // whatever that answer is, it is not this policy's refusal.
    const opened = await fetch(`${server.baseUrl}/api/v1/terminals`, {
      method: "POST",
      headers: {
        [PATCHER_APP_KEY_HEADER]: TEST_APP_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ environmentId: "env-1" }),
    });
    expect(opened.status).not.toBe(403);

    const listed = await fetch(`${server.baseUrl}/api/v1/projects`, {
      headers: { [PATCHER_APP_KEY_HEADER]: TEST_APP_API_KEY },
    });
    expect(listed.status).toBe(200);

    // Including the settings the turn above was refused: the route works, and
    // whose request it is decides.
    const settings = await fetch(
      `${server.baseUrl}/api/v1/settings/general`,
      appPut({
        ...defaultAppSettings,
        providerEgressAllowedHosts: ["github.com"],
      }),
    );
    expect(settings.status).toBe(200);
    expect((await settings.json()) as AppSettings).toMatchObject({
      providerEgressAllowedHosts: ["github.com"],
    });
  });
});

/**
 * The route policy deliberately leaves `/threads/:id/interactions` reachable —
 * `patcher thread interactions deny/answer --self` are agent affordances. The
 * one shape that is not is a turn *allowing* its own permission prompt, which is
 * refused in the handler, where the resolution's shape is visible.
 */
describe("a turn allowing its own permission prompt", () => {
  async function resolveAsAgent(decision: string): Promise<Response> {
    server = await startTestServer();
    // The turn's own thread, in the path and in the headers: a credential is
    // now held to a live turn, so the caller has to be a thread that exists.
    const threadId = seedThreadMidTurn(server.deps);
    return fetch(
      `${server.baseUrl}/api/v1/threads/${threadId}/interactions/pint_abc234567z/resolve`,
      {
        method: "POST",
        headers: agentHeaders(threadId),
        body: JSON.stringify(
          decision === "deny"
            ? { decision: "deny" }
            : { decision, grantedPermissions: null },
        ),
      },
    );
  }

  it("is refused for allow_once", async () => {
    const response = await resolveAsAgent("allow_once");

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("allowed by the user");
  });

  it("is refused for allow_for_session", async () => {
    const response = await resolveAsAgent("allow_for_session");

    expect(response.status).toBe(403);
  });

  it("does not stand in the way of denying, which lowers privilege", async () => {
    // Reaches the handler, which then answers on the request's own merits — the
    // thread and interaction do not exist here, so any status but this policy's
    // 403 is the assertion.
    const response = await resolveAsAgent("deny");

    expect(response.status).not.toBe(403);
  });
});

/**
 * The settings writes this server actually mounts, read off the router.
 *
 * The deny entry is the `/settings` prefix, so a settings route added later is
 * refused without anyone touching the policy — that is what the prefix is for,
 * and this test agrees with it rather than proving it. What it catches is the
 * edit that narrows the prefix back into a route apiece: forget one of the four
 * and it fails here instead of in a turn. It reads Hono's own table for the
 * same reason `plugin-api-path-coverage.test.ts` does — a hand-written list is
 * the thing that falls behind the server.
 */
describe("every settings write this server mounts", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness();
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("is refused for a turn caller", () => {
    const mounted = harness.app.routes
      .filter((route) => route.path.startsWith("/api/v1/settings"))
      .flatMap((route) =>
        // A wildcard mount answers every method, so charge it every one that
        // writes rather than reading "ALL" as a method of its own.
        (route.method === "ALL" ? MUTATION_METHODS : [route.method])
          .filter((method) => MUTATION_METHODS.includes(method))
          .map((method) => ({ method, path: route.path })),
      );

    // A check whose evidence can be empty is not a check.
    expect(mounted.length).toBeGreaterThanOrEqual(4);
    expect(
      mounted
        .filter((request) => agentRoutePolicyDenial(request) === null)
        .map((request) => `${request.method} ${request.path}`),
    ).toEqual([]);
  });
});
