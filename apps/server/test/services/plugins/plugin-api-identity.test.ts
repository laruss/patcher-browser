import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isConsentPendingInteraction,
  permissionsForApiPath,
} from "@patcher/domain";
import {
  createPluginApiFetch,
  createPluginApiIdentities,
  PLUGIN_API_ID_HEADER,
  PLUGIN_API_KEY_HEADER,
} from "../../../src/services/plugins/plugin-api-identity.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

/**
 * `patcher.sdk` is an HTTP client for Patcher's own API, and every plugin is handed the
 * loopback URL, so a gate on the SDK object alone is a gate on the polite way
 * in. These are about the other way: a request that says which plugin it is,
 * and the API applying that plugin's permissions to it.
 */

const BASE = "http://127.0.0.1:3334";

async function writePlugin(
  dir: string,
  options: { name: string; permissions?: readonly string[] },
): Promise<string> {
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      patcher: {
        name: "Identity fixture",
        description: "Loopback identity fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        ...(options.permissions === undefined
          ? {}
          : { permissions: options.permissions }),
      },
    }),
  );
  await writeFile(
    join(rootDir, "server.ts"),
    "export default function plugin() {}",
  );
  return rootDir;
}

/**
 * The link that makes the gate live rather than inert: the SDK client a plugin
 * is given has to sign its requests. Tested here rather than through a real
 * socket, which the in-memory harness does not have.
 */
describe("the plugin's own SDK client signs its requests", () => {
  it("attaches the plugin's identity to every call", async () => {
    let seen: Headers | undefined;
    const signed = createPluginApiFetch({
      pluginId: "notes",
      key: "the-key",
      fetch: async (_input, init) => {
        seen = new Headers(init?.headers);
        return new Response("{}");
      },
    });

    await signed("http://127.0.0.1:1/api/v1/threads");

    expect(seen?.get(PLUGIN_API_ID_HEADER)).toBe("notes");
    expect(seen?.get(PLUGIN_API_KEY_HEADER)).toBe("the-key");
  });

  it("keeps the caller's own headers and overrides only its identity", async () => {
    let seen: Headers | undefined;
    const signed = createPluginApiFetch({
      pluginId: "notes",
      key: "the-key",
      fetch: async (_input, init) => {
        seen = new Headers(init?.headers);
        return new Response("{}");
      },
    });

    await signed("http://127.0.0.1:1/api/v1/threads", {
      headers: {
        "content-type": "application/json",
        // A plugin claiming to be another one does not get to, through here.
        [PLUGIN_API_ID_HEADER]: "secrets",
      },
    });

    expect(seen?.get("content-type")).toBe("application/json");
    expect(seen?.get(PLUGIN_API_ID_HEADER)).toBe("notes");
  });

  it("mints a stable key per plugin and a different one per plugin", () => {
    const identities = createPluginApiIdentities();

    expect(identities.keyFor("a")).toBe(identities.keyFor("a"));
    expect(identities.keyFor("a")).not.toBe(identities.keyFor("b"));
    expect(identities.resolve({ id: "a", key: identities.keyFor("a") })).toBe(
      "a",
    );
    expect(
      identities.resolve({ id: "b", key: identities.keyFor("a") }),
    ).toBeNull();
  });

  it("stops verifying a key it has forgotten", () => {
    const identities = createPluginApiIdentities();
    const key = identities.keyFor("gone");

    identities.forget("gone");

    expect(identities.resolve({ id: "gone", key })).toBeNull();
  });
});

async function waitForConsentInteraction(
  harness: TestAppHarness,
  threadId: string,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [interaction] =
      harness.deps.pendingInteractions.listPendingThreadInteractions(threadId);
    if (interaction && isConsentPendingInteraction(interaction)) {
      return interaction;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("No consent interaction was raised");
}

describe("plugin identity on the loopback API", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness();
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  async function install(
    name: string,
    permissions?: readonly string[],
  ): Promise<{ id: string; headers: Record<string, string> }> {
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      { name, permissions },
    );
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
    return {
      id: entry.id,
      headers: {
        [PLUGIN_API_ID_HEADER]: entry.id,
        [PLUGIN_API_KEY_HEADER]: harness.pluginService.apiIdentities.keyFor(
          entry.id,
        ),
      },
    };
  }

  it("refuses a plugin the answer to a consent prompt", async () => {
    // The gate that keeps a turn from answering its own prompt is the declared
    // thread header, which a plugin never sends — so `threads` was enough to
    // answer a prompt raised for somebody else, and the timeline would record
    // the *user* as having allowed it. That record is what the prompt is for.
    const { headers, id } = await install("patcher-plugin-answerer", [
      "threads",
    ]);
    const { host } = seedHostSession(harness.deps, { id: "host-consent" });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const thread = seedThread(harness.deps, {
      environmentId: environment.id,
      projectId: project.id,
    });
    void harness.deps.pendingInteractions.requestConsentInteraction({
      threadId: thread.id,
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
    const interaction = await waitForConsentInteraction(harness, thread.id);

    const response = await harness.app.request(
      `${BASE}/api/v1/threads/${thread.id}/interactions/${interaction.id}/respond`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ value: { kind: "consent", approved: true } }),
      },
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { message: string };
    // Names the plugin: whoever reads the log should not have to work out which
    // caller was refused.
    expect(body.message).toContain(id);
    expect(body.message).toContain("answered by the user");
    // And nothing was decided.
    expect(
      harness.deps.pendingInteractions.listPendingThreadInteractions(thread.id),
    ).toHaveLength(1);
  });

  it("refuses a path the plugin did not declare", async () => {
    const { headers } = await install("patcher-plugin-quiet");

    const response = await harness.app.request(`${BASE}/api/v1/threads`, {
      headers,
    });

    expect(response.status).toBe(403);
    expect((await response.json()) as { message: string }).toMatchObject({
      message: expect.stringContaining('"threads" is required'),
    });
  });

  it("lets the same request through once declared", async () => {
    const { headers } = await install("patcher-plugin-reader", ["threads"]);

    const response = await harness.app.request(`${BASE}/api/v1/threads`, {
      headers,
    });

    expect(response.status).toBe(200);
  });

  // The whole point: the identity is what changes the answer, so the same URL
  // that a plugin is refused stays open to the app.
  it("leaves unidentified callers alone", async () => {
    await install("patcher-plugin-quiet");

    const response = await harness.app.request(`${BASE}/api/v1/threads`);

    expect(response.status).toBe(200);
  });

  it("treats a wrong key as no identity rather than as an error", async () => {
    const { id } = await install("patcher-plugin-quiet");

    const response = await harness.app.request(`${BASE}/api/v1/threads`, {
      headers: {
        [PLUGIN_API_ID_HEADER]: id,
        [PLUGIN_API_KEY_HEADER]: "not-the-key",
      },
    });

    expect(response.status).toBe(200);
  });

  // An unclassified path is one nobody decided about, and deciding by default
  // is how a new route quietly becomes reachable by every plugin.
  it("refuses a path carrying no classification", async () => {
    const { headers } = await install("patcher-plugin-reader", ["threads"]);
    expect(permissionsForApiPath("/api/v1/nothing-here")).toBeNull();

    const response = await harness.app.request(`${BASE}/api/v1/nothing-here`, {
      headers,
    });

    expect(response.status).toBe(403);
  });

  // patcher.sdk goes over this same API, so the gate it passes in JavaScript must
  // be the gate it passes on the wire — otherwise one of them is decoration.
  it("gates patcher.sdk itself, because patcher.sdk is this API", async () => {
    const { headers } = await install("patcher-plugin-partial", ["workspace"]);

    const allowed = await harness.app.request(`${BASE}/api/v1/projects`, {
      headers,
    });
    const refused = await harness.app.request(`${BASE}/api/v1/threads`, {
      headers,
    });

    expect(allowed.status).toBe(200);
    expect(refused.status).toBe(403);
  });
});
