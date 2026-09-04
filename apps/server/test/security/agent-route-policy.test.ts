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
  createCommandApprovalPayload,
  createDenyResolution,
} from "../helpers/pending-interactions.js";
import {
  seedHost,
  seedProjectWithSource,
  seedThread,
  seedThreadFixture,
  seedTurnStarted,
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
    // inside, read again when the next turn is built. Denied by the prefix, so
    // a settings route added beside them is denied too.
    for (const path of [
      "/api/v1/settings/general",
      "/api/v1/settings/experiments",
      "/api/v1/settings/network-that-does-not-exist-yet",
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

  it("keeps the two settings writes that are the person's look, not the turn's boundary", () => {
    // The cost of a prefix is that it closes what nobody meant to close. The
    // built-in CLI skill's `theming.md` is a theme-authoring guide that has a
    // turn write `theme.css` and then run `patcher theme set` — which is
    // `PUT /settings/appearance` — so denying it would have left a documented
    // workflow one command short of working.
    for (const path of [
      "/api/v1/settings/appearance",
      "/api/v1/settings/keyboard",
    ]) {
      expect(agentRoutePolicyDenial({ method: "PUT", path })).toBeNull();
    }
    // The exception is to a mutation deny and to nothing else: a sibling it
    // does not name is still refused.
    expect(
      agentRoutePolicyDenial({
        method: "PUT",
        path: "/api/v1/settings/appearances",
      }),
    ).not.toBeNull();
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

  it("can still apply a theme, which is the workflow the skill documents", async () => {
    server = await startTestServer();

    // The last command of `references/theming.md`: the turn writes `theme.css`
    // and runs `patcher theme set`, which is this route. Refusing it with the
    // prefix would have left that guide one step short of working.
    const response = await fetch(
      `${server.baseUrl}/api/v1/settings/appearance`,
      {
        method: "PUT",
        headers: agentHeaders(seedThreadMidTurn(server.deps)),
        body: JSON.stringify({ themeId: "nord", faviconColor: "blue" }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ themeId: "nord" });
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
    // A real interaction rather than a made-up id, and the denial asserted as
    // having happened: "any status but this policy's 403" would pass just as
    // well on a handler that answered 404, which is what this used to assert.
    server = await startTestServer();
    const running = server;
    // Its own fixture rather than `seedThreadMidTurn`, because resolving for
    // real needs a workspace and a connected machine to dispatch to, and the
    // three refusals above deliberately have neither: the gate answers before
    // the thread is looked up, and their made-up ids are what shows that.
    const { thread } = seedThreadFixture(running, {
      session: { id: "host-agent-deny" },
      thread: { status: "active" },
    });
    const threadId = thread.id;
    seedTurnStarted(running.deps, {
      threadId,
      turnId: "turn-agent-deny",
      providerThreadId: "provider-thread-agent-deny",
    });
    const registered =
      running.deps.pendingInteractions.registerPendingInteraction({
        interaction: {
          threadId,
          turnId: "turn-agent-deny",
          providerId: "codex",
          providerThreadId: "provider-thread-agent-deny",
          providerRequestId: "request-agent-deny",
          payload: createCommandApprovalPayload({
            command: "git push",
            cwd: "/tmp/project",
            itemId: "item-1",
            reason: "Approve command",
          }),
        },
      });
    if (registered.outcome === "rejected") {
      throw new Error(
        `Expected interaction registration to succeed: ${registered.reason}`,
      );
    }

    const response = await fetch(
      `${running.baseUrl}/api/v1/threads/${threadId}/interactions/${registered.interaction.id}/resolve`,
      {
        method: "POST",
        headers: agentHeaders(threadId),
        body: JSON.stringify(createDenyResolution()),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: registered.interaction.id,
      resolution: createDenyResolution(),
      status: "resolving",
    });
  });
});

/**
 * And the neighbour of it: dismissing the prompt instead of answering it.
 *
 * A dismissal is not a denial. It is recorded as the person having closed the
 * question without deciding — the setup-script transcript says so in as many
 * words — and nobody remembers it: a dismissed reach-host prompt resolves to
 * `unanswered`, which the egress proxy deliberately does not remember. So a
 * turn that could dismiss its own prompt could re-raise it on every retry, and
 * the person would never get to give the remembered "no" that is what stops
 * retry-until-someone-gives-in.
 */
describe("a turn dismissing a consent prompt raised on its thread", () => {
  async function consentPromptOnAgentThread(): Promise<{
    interactionId: string;
    threadId: string;
  }> {
    server = await startTestServer();
    const running = server;
    const threadId = seedThreadMidTurn(running.deps);
    void running.deps.pendingInteractions.requestConsentInteraction({
      threadId,
      timeoutMs: 60_000,
      payload: {
        kind: "consent",
        action: "enable",
        subjectId: "some-plugin",
        subjectName: "Some plugin",
        permissions: [],
        sites: [],
        detail: null,
      },
    });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [interaction] =
        running.deps.pendingInteractions.listPendingThreadInteractions(
          threadId,
        );
      if (interaction) return { interactionId: interaction.id, threadId };
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("No consent interaction was raised");
  }

  it("is refused, and the question still stands", async () => {
    const { interactionId, threadId } = await consentPromptOnAgentThread();
    const running = server;
    if (running === null) throw new Error("Expected a running server");

    const response = await fetch(
      `${running.baseUrl}/api/v1/threads/${threadId}/interactions/${interactionId}/cancel`,
      { method: "POST", headers: agentHeaders(threadId) },
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("dismissed by the user");
    // The prompt, not just the answer: a route that cancelled and then threw
    // the same 403 would pass on the response alone.
    expect(
      running.deps.pendingInteractions.listPendingThreadInteractions(threadId),
    ).toHaveLength(1);
  });

  it("leaves the person at the machine dismissing it", async () => {
    const { interactionId, threadId } = await consentPromptOnAgentThread();
    const running = server;
    if (running === null) throw new Error("Expected a running server");

    const response = await fetch(
      `${running.baseUrl}/api/v1/threads/${threadId}/interactions/${interactionId}/cancel`,
      {
        method: "POST",
        headers: { [PATCHER_APP_KEY_HEADER]: TEST_APP_API_KEY },
      },
    );

    expect(response.status).toBe(200);
    expect(
      running.deps.pendingInteractions.listPendingThreadInteractions(threadId),
    ).toHaveLength(0);
  });
});

/**
 * The settings writes this server actually mounts, read off the router.
 *
 * The prefix denies them all and two are excepted by name, so what needs
 * checking is not "are they refused" but "is the set of exceptions still the
 * set somebody decided on". Mount `/settings/network` tomorrow and it is denied
 * by the prefix and this list does not move; make it an exception, or narrow
 * the prefix back into a route apiece and forget one, and the list grows here
 * rather than in a turn.
 *
 * It reads Hono's own table for the same reason `plugin-api-path-coverage.test.ts`
 * does — a hand-written list of routes is the thing that falls behind the server.
 */
describe("the settings writes this server mounts", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness();
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("are refused for a turn caller, except the two that are decided", () => {
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
        .map((request) => `${request.method} ${request.path}`)
        .sort(),
    ).toEqual([
      "PUT /api/v1/settings/appearance",
      "PUT /api/v1/settings/keyboard",
    ]);
  });
});
