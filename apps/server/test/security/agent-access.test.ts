import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { deriveAgentAccessKey } from "@patcher/config/agent-access-key";
import { PATCHER_APP_KEY_HEADER } from "@patcher/config/app-key";
import {
  createBrowserAccessGrant,
  getBrowserAccessGrant,
  listBrowserAccessGrants,
  revokeBrowserAccessGrant,
  setAppSettings,
  getAppSettings,
  type BrowserAccessGrantRow,
} from "@patcher/db";
import type { BrowserAccessGrantLevel } from "@patcher/domain";
import { deriveThreadTurnApiKey } from "@patcher/config/thread-api-key";
import {
  PATCHER_AGENT_KEY_HEADER,
  PATCHER_THREAD_ID_HEADER,
  PATCHER_THREAD_KEY_HEADER,
} from "@patcher/server-contract";
import { builtinPluginSource } from "../../src/services/plugins/builtin-registry.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import {
  startTestServer,
  TEST_APP_API_KEY,
  type RunningTestServer,
} from "../helpers/test-app.js";

/**
 * The credential an agent outside Patcher holds instead of the app key, and the
 * two routes it reaches.
 *
 * Every request here goes over a real socket with a plain `fetch`, deliberately
 * — `harness.app` puts the app key on everything, and a grant that only works
 * while the app key is beside it would be no credential at all. That is the
 * same reason `app-identity.test.ts` uses this shape.
 *
 * What these are trying to catch, stated so a later reader can check whether
 * they still do: a grant that reaches more than the browser, a grant that
 * outlives its revocation, a grant that can widen itself, and a grant whose
 * level is quietly taken from the install-wide setting instead of from its own
 * row.
 */

const AGENT_KEY_HEADER = PATCHER_AGENT_KEY_HEADER;

let server: RunningTestServer | undefined;
const sockets = new Set<WebSocket>();

afterEach(async () => {
  for (const socket of sockets) socket.terminate();
  sockets.clear();
  await server?.close();
  server = undefined;
});

/** Resolves to the upgrade's HTTP status, or null if the socket opened. */
function websocketStatus(
  url: string,
  headers: Record<string, string>,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    sockets.add(socket);
    socket.once("open", () => resolve(null));
    socket.once("unexpected-response", (_request, response) => {
      const status = response.statusCode;
      response.resume();
      if (status === undefined) {
        reject(new Error("WebSocket rejection omitted an HTTP status"));
        return;
      }
      resolve(status);
    });
    socket.once("error", (error) => reject(error));
  });
}

function websocketUrl(baseUrl: string, path: string): string {
  const url = new URL(path, baseUrl);
  url.protocol = "ws:";
  return url.href;
}

function issueGrant(
  running: RunningTestServer,
  level: BrowserAccessGrantLevel = "read",
  label = "Claude Code",
): { grant: BrowserAccessGrantRow; key: string } {
  const grant = createBrowserAccessGrant(running.deps.db, { label, level });
  return {
    grant,
    key: deriveAgentAccessKey({
      appApiKey: TEST_APP_API_KEY,
      grantId: grant.id,
    }),
  };
}

/** A request carrying the grant and *no* app key, the way a real one does. */
function grantFetch(
  running: RunningTestServer,
  path: string,
  key: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${running.baseUrl}${path}`, {
    ...init,
    headers: { ...init.headers, [AGENT_KEY_HEADER]: key },
  });
}

async function runBrowserCli(
  running: RunningTestServer,
  key: string,
  argv: readonly string[],
): Promise<{ status: number; body: string }> {
  const response = await grantFetch(
    running,
    "/api/v1/plugins/browser-tools/cli",
    key,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ argv }),
    },
  );
  return { status: response.status, body: await response.text() };
}

describe("a browser access grant", () => {
  it("reaches the two routes it was issued for", async () => {
    server = await startTestServer();
    const { key } = issueGrant(server);

    const contributions = await grantFetch(
      server,
      "/api/v1/plugins/contributions",
      key,
    );

    // Without this one, `patcher browser` never becomes a command: the CLI
    // reads the plugin CLI table from it before it can route the argv.
    expect(contributions.status).toBe(200);
  });

  it("reaches nothing else, and is told what it does reach", async () => {
    server = await startTestServer();
    const { key } = issueGrant(server, "full");

    for (const path of [
      "/api/v1/projects",
      "/api/v1/threads",
      "/api/v1/terminals",
      "/api/v1/settings/general",
      "/api/v1/system/config",
      // The whole plugin list: a broader read than the browser, and not
      // needed, because a grant is issued with browser-tools already on.
      "/api/v1/plugins",
    ]) {
      const response = await grantFetch(server, path, key);
      expect([path, response.status]).toEqual([path, 403]);
      const body = (await response.json()) as { message?: string };
      // The offer, not the rule: a model told only "no" tries the neighbour.
      expect(body.message).toContain("/plugins/browser-tools/cli");
    }
  });

  it("cannot run another plugin's CLI", async () => {
    // The reason the allow-list spells the plugin id rather than
    // `/plugins/:id/cli`: a plugin with `shell` or `files` and a command of its
    // own would otherwise be reachable with a credential issued for the
    // browser.
    server = await startTestServer();
    const { key } = issueGrant(server, "full");

    const response = await grantFetch(
      server,
      "/api/v1/plugins/some-other-plugin/cli",
      key,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ argv: [] }),
      },
    );

    expect(response.status).toBe(403);
  });

  it("cannot mint itself a second grant, or a wider one", async () => {
    server = await startTestServer();
    const { key } = issueGrant(server, "read");

    const response = await grantFetch(
      server,
      "/api/v1/browser/access-grants",
      key,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "wider", level: "full" }),
      },
    );

    expect(response.status).toBe(403);
    // Nothing was written: the only grant on this install is still the one.
    expect(listBrowserAccessGrants(server.deps.db)).toHaveLength(1);
  });

  it("is not mintable from inside a turn either", async () => {
    // A different caller and the same argument, one policy over. A thread
    // credential dies with its turn; a grant does not, so a turn that could
    // call this would have minted itself a browser key that outlives it. The
    // level route beside it *is* a turn's to ask for, with a prompt.
    server = await startTestServer();
    const { host } = seedHostSession(server.deps, { id: "host-grant-turn" });
    const { project } = seedProjectWithSource(server.deps, { hostId: host.id });
    const environment = seedEnvironment(server.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const thread = seedThread(server.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "active",
    });
    const turnHeaders = {
      [PATCHER_THREAD_ID_HEADER]: thread.id,
      [PATCHER_THREAD_KEY_HEADER]: deriveThreadTurnApiKey({
        appApiKey: TEST_APP_API_KEY,
        threadId: thread.id,
      }),
    };

    const response = await fetch(
      `${server.baseUrl}/api/v1/browser/access-grants`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...turnHeaders },
        body: JSON.stringify({ label: "mine", level: "full" }),
      },
    );

    expect(response.status).toBe(403);
    expect(listBrowserAccessGrants(server.deps.db)).toEqual([]);
    // Reading the list is still open: it carries labels and dates, never a
    // credential.
    const list = await fetch(`${server.baseUrl}/api/v1/browser/access-grants`, {
      headers: turnHeaders,
    });
    expect(list.status).toBe(200);
  });

  it("cannot raise the install-wide level either", async () => {
    server = await startTestServer();
    const { key } = issueGrant(server, "read");

    const response = await grantFetch(
      server,
      "/api/v1/browser/external-access",
      key,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: "full" }),
      },
    );

    expect(response.status).toBe(403);
    expect(getAppSettings(server.deps.db).browserExternalAccess).toBe("off");
  });

  it("stops working the moment it is revoked, and says so", async () => {
    server = await startTestServer();
    const { grant, key } = issueGrant(server);
    expect(
      (await grantFetch(server, "/api/v1/plugins/contributions", key)).status,
    ).toBe(200);

    revokeBrowserAccessGrant(server.deps.db, grant.id);

    const response = await grantFetch(
      server,
      "/api/v1/plugins/contributions",
      key,
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { message?: string };
    // The one thing the holder cannot see for itself.
    expect(body.message).toContain("revoked");
    expect(body.message).toContain(grant.id);
  });

  it("is refused when its grant is gone rather than revoked", async () => {
    server = await startTestServer();
    // A credential naming a row that never existed: the MAC verifies, because
    // it is derived from this install's app key, and the row is the lifetime.
    const key = deriveAgentAccessKey({
      appApiKey: TEST_APP_API_KEY,
      grantId: "bag_neverexisted",
    });

    const response = await grantFetch(
      server,
      "/api/v1/plugins/contributions",
      key,
    );

    expect(response.status).toBe(401);
    expect(((await response.json()) as { message?: string }).message).toContain(
      "no longer exists",
    );
  });

  it("is refused when it came from another install", async () => {
    server = await startTestServer();
    const { grant } = issueGrant(server);
    const foreign = deriveAgentAccessKey({
      appApiKey: "a-different-installs-app-key",
      grantId: grant.id,
    });

    const response = await grantFetch(
      server,
      "/api/v1/plugins/contributions",
      foreign,
    );

    expect(response.status).toBe(401);
    expect(((await response.json()) as { message?: string }).message).toContain(
      "not one this Patcher issued",
    );
  });

  it("does not turn a stray header into a grant refusal", async () => {
    // Junk in the header is not a grant credential at all, so the caller falls
    // through to the ordinary app-key answer rather than being told about
    // grants it never had.
    server = await startTestServer();

    const response = await fetch(`${server.baseUrl}/api/v1/projects`, {
      headers: { [AGENT_KEY_HEADER]: "not-a-credential" },
    });

    expect(response.status).toBe(401);
    expect(
      ((await response.json()) as { message?: string }).message,
    ).not.toContain("grant");
  });

  it("records that it was used", async () => {
    server = await startTestServer();
    const { grant, key } = issueGrant(server);
    expect(getBrowserAccessGrant(server.deps.db, grant.id)?.lastUsedAt).toBe(
      null,
    );

    // A *refused* request too: the field answers "is anything still using
    // this", and a refusal is a use.
    await grantFetch(server, "/api/v1/threads", key);

    expect(
      getBrowserAccessGrant(server.deps.db, grant.id)?.lastUsedAt,
    ).toBeTypeOf("number");
  });

  it("wins over the app key when a caller presents both", async () => {
    // Not a case Patcher creates — the CLI drops the app key when it holds a
    // grant — but the ordering matters and it points the safe way: presenting
    // a grant narrows a caller rather than widening it.
    server = await startTestServer();
    const { key } = issueGrant(server, "full");

    const response = await fetch(`${server.baseUrl}/api/v1/threads`, {
      headers: {
        [AGENT_KEY_HEADER]: key,
        [PATCHER_APP_KEY_HEADER]: TEST_APP_API_KEY,
      },
    });

    expect(response.status).toBe(403);
  });

  it("cannot open either websocket", async () => {
    // Neither is under `/api/v1`, so neither passes the gate above: they take
    // the app key or a plugin's header pair on their own, and a grant presents
    // neither. The "I am the browser" role on that hub, and a terminal's live
    // stream, are not a grant's to claim. Measured rather than argued — an
    // upgrade is a different code path from a request.
    //
    // What this pins is that the upgrade stays closed to an unidentified
    // caller, which it was before this branch too: a grant header changes
    // nothing there and is sent only so the case is the real one. It would not
    // fail if the grant were somehow admitted *as the app*; the thing that
    // makes that impossible is that a grant is never the app key.
    server = await startTestServer();
    const { key } = issueGrant(server, "full");
    const headers = { [AGENT_KEY_HEADER]: key };

    expect(
      await websocketStatus(websocketUrl(server.baseUrl, "/ws"), headers),
    ).toBe(401);
    expect(
      await websocketStatus(
        websocketUrl(server.baseUrl, "/ws/terminals/term_anything"),
        headers,
      ),
    ).toBe(401);
  });
});

describe("a browser command charged to a grant", () => {
  it("is charged the grant's own level, not the install-wide setting", async () => {
    server = await startTestServer();
    await server.pluginService.install(builtinPluginSource("browser-tools"));
    // The setting is `off`, which is the recommended shape: the browser is
    // closed to every unnamed caller and open to this one credential. A grant
    // that needed the setting raised first would be worth nothing — raising it
    // is what opens the browser to every process on the machine.
    expect(getAppSettings(server.deps.db).browserExternalAccess).toBe("off");
    const { key } = issueGrant(server, "read");

    const { status, body } = await runBrowserCli(server, key, ["tabs"]);

    expect(status).toBe(200);
    // No browser window is connected in a harness, so this is as far as it can
    // get — and *which* failure is the assertion. The hub's answer is positive
    // evidence that the command was dispatched; the gate refuses before that,
    // and its refusal is the sentence asserted against below.
    expect(body).toContain("No browser window is connected");
    expect(body).not.toContain("browser access grant");
  });

  it("is refused above its level, and named in the refusal", async () => {
    server = await startTestServer();
    await server.pluginService.install(builtinPluginSource("browser-tools"));
    const { grant, key } = issueGrant(server, "read", "Codex");

    // `cookie-list` costs `page.credentials`, which only `full` admits.
    const { body } = await runBrowserCli(server, key, ["cookie-list"]);

    expect(body).toContain("Codex");
    expect(body).toContain(grant.id);
  });

  it("is not widened by the install-wide setting", async () => {
    // The other direction of the same independence: a person who opened the
    // browser to app-key callers has not thereby widened every grant.
    server = await startTestServer();
    await server.pluginService.install(builtinPluginSource("browser-tools"));
    setAppSettings(server.deps.db, {
      ...getAppSettings(server.deps.db),
      browserExternalAccess: "full",
    });
    const { key } = issueGrant(server, "read");

    const { body } = await runBrowserCli(server, key, ["cookie-list"]);

    expect(body).toContain("browser access grant");
  });
});
