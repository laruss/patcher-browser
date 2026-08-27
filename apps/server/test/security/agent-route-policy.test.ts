import { afterEach, describe, expect, it } from "vitest";
import { agentRoutePolicyDenial } from "../../src/agent-route-policy.js";
import { createThreadApiIdentity } from "../../src/thread-identity.js";
import { deriveThreadApiKey } from "@patcher/config/thread-api-key";
import { PATCHER_APP_KEY_HEADER } from "@patcher/config/app-key";
import {
  PATCHER_THREAD_ID_HEADER,
  PATCHER_THREAD_KEY_HEADER,
} from "@patcher/server-contract";
import {
  startTestServer,
  TEST_APP_API_KEY,
  type RunningTestServer,
} from "../helpers/test-app.js";

const APP_KEY = "app-key-for-agent-route-policy";

function carrier(headers: Record<string, string>) {
  return { header: (name: string) => headers[name] };
}

let server: RunningTestServer | null = null;

afterEach(async () => {
  if (server !== null) {
    await server.close();
    server = null;
  }
});

/** The headers a turn's `patcher` CLI sends: its thread, and no app key. */
function agentHeaders(threadId = "thr-agent-1"): Record<string, string> {
  return {
    [PATCHER_THREAD_ID_HEADER]: threadId,
    [PATCHER_THREAD_KEY_HEADER]: deriveThreadApiKey({
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

  it("refuses opening a terminal, whatever the sub-route", () => {
    expect(
      agentRoutePolicyDenial({ method: "POST", path: "/api/v1/terminals" }),
    ).not.toBeNull();
    expect(
      agentRoutePolicyDenial({
        method: "POST",
        path: "/api/v1/terminals/term-1/input",
      }),
    ).not.toBeNull();
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
      path: "/api/v1/terminals",
    });

    expect(denial?.route).toBe("/terminals");
    expect(denial?.message).toContain("outside this turn's sandbox");
    expect(denial?.message).toContain("Ask the person in the thread");
  });
});

describe("createThreadApiIdentity", () => {
  const identity = createThreadApiIdentity(APP_KEY);

  it("resolves the thread whose key verifies", () => {
    expect(
      identity.resolve(
        carrier({
          [PATCHER_THREAD_ID_HEADER]: "thr-1",
          [PATCHER_THREAD_KEY_HEADER]: deriveThreadApiKey({
            appApiKey: APP_KEY,
            threadId: "thr-1",
          }),
        }),
      ),
    ).toBe("thr-1");
  });

  it("is nobody without the key, so an agent cannot drop the declaration", () => {
    expect(
      identity.resolve(carrier({ [PATCHER_THREAD_ID_HEADER]: "thr-1" })),
    ).toBeNull();
  });

  it("is nobody when the key does not match the declared thread", () => {
    expect(
      identity.resolve(
        carrier({
          [PATCHER_THREAD_ID_HEADER]: "thr-2",
          [PATCHER_THREAD_KEY_HEADER]: deriveThreadApiKey({
            appApiKey: APP_KEY,
            threadId: "thr-1",
          }),
        }),
      ),
    ).toBeNull();
  });

  it("is nobody for a caller presenting the app key as a thread key", () => {
    expect(
      identity.resolve(
        carrier({
          [PATCHER_THREAD_ID_HEADER]: "thr-1",
          [PATCHER_THREAD_KEY_HEADER]: APP_KEY,
        }),
      ),
    ).toBeNull();
  });

  it("is nobody for a request carrying neither header", () => {
    expect(identity.resolve(carrier({}))).toBeNull();
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
      headers: agentHeaders(),
    });

    expect(response.status).toBe(200);
  });

  it("is refused a write to any path on the machine", async () => {
    server = await startTestServer();

    const response = await fetch(`${server.baseUrl}/api/v1/files/write`, {
      method: "POST",
      headers: agentHeaders(),
      body: JSON.stringify({ path: "/etc/patcher-escape", content: "x" }),
    });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("workspace sandbox");
  });

  it("is refused a terminal on the host", async () => {
    server = await startTestServer();

    const response = await fetch(`${server.baseUrl}/api/v1/terminals`, {
      method: "POST",
      headers: agentHeaders(),
      body: JSON.stringify({ environmentId: "env-1" }),
    });

    expect(response.status).toBe(403);
  });

  it("is refused a raise of its machine's permission ceiling", async () => {
    server = await startTestServer();

    const response = await fetch(
      `${server.baseUrl}/api/v1/hosts/host-1/permission-ceiling`,
      {
        method: "PATCH",
        headers: agentHeaders(),
        body: JSON.stringify({ maxPermissionMode: "full" }),
      },
    );

    expect(response.status).toBe(403);
  });

  it("cannot drop its thread declaration to be taken for the app", async () => {
    server = await startTestServer();

    const response = await fetch(`${server.baseUrl}/api/v1/files/write`, {
      method: "POST",
      headers: {
        [PATCHER_THREAD_KEY_HEADER]: deriveThreadApiKey({
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
        ...agentHeaders(),
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
    return fetch(
      `${server.baseUrl}/api/v1/threads/thr-agent-1/interactions/pint_abc234567z/resolve`,
      {
        method: "POST",
        headers: agentHeaders(),
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
