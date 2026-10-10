import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { PATCHER_APP_KEY_HEADER } from "@patcher/config/app-key";
import { deriveThreadTurnApiKey } from "@patcher/config/thread-api-key";
import {
  PATCHER_THREAD_ID_HEADER,
  PATCHER_THREAD_KEY_HEADER,
} from "@patcher/server-contract";
import { TEST_APP_API_KEY, withTestHarness } from "../../helpers/test-app.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";

it("refuses credential proposals from authenticated thread RPC and unkeyed plugin HTTP, while app RPC reaches the capability", async () => {
  await withTestHarness(async (harness) => {
    const dir = join(harness.config.dataDir, "credential-route-fixture");
    await mkdir(dir);
    await symlink(
      join(process.cwd(), "node_modules"),
      join(dir, "node_modules"),
      "dir",
    );
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "patcher-plugin-credential-route",
        version: "1.0.0",
        engines: { patcherPluginSdk: "^1.2.0" },
        patcher: {
          name: "Credential route",
          description: "Fixture",
          branding: { icon: "Key" },
          server: "./server.ts",
          siteAccess: "runtime",
          sites: ["https://example.com/*"],
          permissions: ["credentials.manage"],
        },
      }),
    );
    await writeFile(
      join(dir, "server.ts"),
      `
      import { defineRpcContract } from "@patcher/plugin-sdk";
      import { z } from "zod";
      export default function plugin(patcher: any) {
        const propose = () => patcher.browser.credentials.request({ operation: "save", tabId: "tab", accountId: "primary" });
        patcher.rpc.register(defineRpcContract({ propose: { input: z.null(), output: z.any() } }), { propose });
        patcher.http.route("GET", "/propose", async (c: any) => {
          try { return c.json(await propose()); } catch { return c.json({ denied: true }); }
        }, { auth: "none" });
      }
    `,
    );
    const plugin = await harness.pluginService.installPath(dir);
    expect(plugin.status).toBe("running");
    const path = `/api/v1/plugins/${plugin.id}`;
    const app = await harness.app.request(`${path}/rpc/propose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    expect(app.status).toBe(200);
    expect(await app.json()).toMatchObject({
      ok: true,
      result: { status: "unavailable" },
    });
    const { host } = seedHostSession(harness.deps),
      { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "active",
    });
    const agent = await harness.app.request(`${path}/rpc/propose`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [PATCHER_THREAD_ID_HEADER]: thread.id,
        [PATCHER_THREAD_KEY_HEADER]: deriveThreadTurnApiKey({
          appApiKey: TEST_APP_API_KEY,
          threadId: thread.id,
        }),
      },
      body: "null",
    });
    expect(agent.status).toBe(500);
    expect(JSON.stringify(await agent.json())).toContain(
      "refuse agent and external callers",
    );
    const external = await harness.app.request(`${path}/http/propose`, {
      headers: { [PATCHER_APP_KEY_HEADER]: "" },
    });
    expect(external.status).toBe(200);
    expect(await external.json()).toEqual({ denied: true });
  });
}, 30_000);

it("carries legacy deputies and original agent scope through real SDK HTTP before a manager broker call", async () => {
  const { serve } = await import("@hono/node-server");
  const { createApp } = await import("../../../src/server.js");
  const { createPluginApiFetch, pluginApiHeaders } =
    await import("../../../src/services/plugins/plugin-api-identity.js");
  const { runAsCredentialAgent } =
    await import("../../../src/services/browser/credential-agent-scope.js");
  const {
    runWithCredentialPluginCallers,
    createCredentialHttpCaller,
    releaseCredentialHttpCaller,
  } = await import("../../../src/services/browser/credential-plugin-caller.js");
  const { randomUUID } = await import("node:crypto");
  await withTestHarness(async (harness) => {
    const context = {
      tabId: "tab",
      url: "https://example.com/login",
      origin: "https://example.com",
      documentId: randomUUID(),
    };
    let brokerCalls = 0;
    const { app, pluginService, closeWebSockets } = createApp(harness.deps, {
      runPluginOutOfProcess: () => true,
      requestSite: async (method) =>
        method === "site.confirm"
          ? context
          : method === "site.context"
            ? { ...context, token: randomUUID(), hostWebContentsId: 12 }
            : true,
      requestCredentials: async () => {
        brokerCalls++;
        return { origin: context.origin };
      },
    });
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
    if (!server.listening)
      await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("No test address");
    harness.config.serverPort = address.port;
    pluginService.bindSdk({ baseUrl: `http://127.0.0.1:${address.port}` });
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const install = async (
        name: string,
        runtime: boolean,
        permissions: string[],
        manager = false,
      ) => {
        const dir = join(harness.config.dataDir, name);
        await mkdir(dir);
        await symlink(
          join(process.cwd(), "node_modules"),
          join(dir, "node_modules"),
          "dir",
        );
        await writeFile(
          join(dir, "package.json"),
          JSON.stringify({
            name: `patcher-plugin-${name}`,
            version: "1.0.0",
            engines: { patcherPluginSdk: "^1.2.0" },
            patcher: {
              name,
              description: "Fixture",
              branding: { icon: "Key" },
              server: "./server.ts",
              permissions,
              ...(runtime
                ? { siteAccess: "runtime", sites: ["https://example.com/*"] }
                : {}),
            },
          }),
        );
        const source = manager
          ? `import { defineRpcContract } from "@patcher/plugin-sdk"; import { z } from "zod"; export default function plugin(patcher: any) { patcher.rpc.register(defineRpcContract({ list: { input: z.null(), output: z.any() } }), { list: () => patcher.browser.credentials.list({ tabId: "tab" }) }); }`
          : `import { defineRpcContract } from "@patcher/plugin-sdk"; import { z } from "zod"; export default function plugin(patcher: any) { patcher.rpc.register(defineRpcContract({ forward: { input: z.null(), output: z.any() } }), { forward: () => patcher.sdk.plugins.callRpc({ pluginId: "credential-manager", method: "list", input: null, outputSchema: z.any() }) }); }`;
        await writeFile(join(dir, "server.ts"), source);
        const plugin = await pluginService.installPath(dir);
        expect(plugin.status).toBe("running");
        return plugin.id;
      };
      const manager = await install(
        "credential-manager",
        true,
        ["credentials.manage"],
        true,
      );
      const legacy = await install("legacy-deputy", false, []);
      const permitted = await install("permitted-deputy", true, [
        "credentials.manage",
        "plugins",
      ]);
      await pluginService.siteAccess!.confirm(manager, "tab");
      await pluginService.siteAccess!.confirm(permitted, "tab");
      const url = `${base}/api/v1/plugins/${manager}/rpc/list`,
        init = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "null",
        };
      const sdkFetch = (id: string) =>
        createPluginApiFetch({
          pluginId: id,
          key: pluginService.apiIdentities.keyFor(id),
          credentialCaller: {
            create: async () => createCredentialHttpCaller(id),
            release: async (token) => releaseCredentialHttpCaller(id, token),
          },
        });
      const denied = await sdkFetch(legacy)(url, init);
      expect(denied.status).toBe(500);
      expect(brokerCalls).toBe(0);
      const allowed = await sdkFetch(permitted)(url, init);
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toMatchObject({ result: [] });
      expect(brokerCalls).toBe(1);
      const agent = await runAsCredentialAgent(() =>
        sdkFetch(permitted)(url, init),
      );
      expect(agent.status).toBe(500);
      expect(brokerCalls).toBe(1);
      const nested = await runWithCredentialPluginCallers([legacy], () =>
        sdkFetch(permitted)(url, init),
      );
      expect(nested.status).toBe(500);
      expect(brokerCalls).toBe(1);
      const forwardUrl = `${base}/api/v1/plugins/${permitted}/rpc/forward`;
      const positive = await fetch(forwardUrl, {
        ...init,
        headers: {
          ...init.headers,
          [PATCHER_APP_KEY_HEADER]: TEST_APP_API_KEY,
        },
      });
      expect(positive.status).toBe(200);
      expect(brokerCalls).toBe(2);
      const forward = pluginService.getRpcHandler(permitted, "forward");
      if (forward.outcome !== "found") throw Error("Missing deputy handler");
      const fromPage = await pluginService.siteAccess!.pageRpc(
        permitted,
        randomUUID(),
        "forward",
        "null",
        () =>
          pluginService.invokeRpcHandler(
            permitted,
            "forward",
            forward.value,
            null,
          ),
      );
      expect(fromPage.ok).toBe(false);
      expect(brokerCalls).toBe(2); // Page → real child → SDK HTTP → manager cannot borrow human scope.
      const { host } = seedHostSession(harness.deps),
        { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      const childAgent = await fetch(forwardUrl, {
        ...init,
        headers: {
          ...init.headers,
          [PATCHER_THREAD_ID_HEADER]: thread.id,
          [PATCHER_THREAD_KEY_HEADER]: deriveThreadTurnApiKey({
            appApiKey: TEST_APP_API_KEY,
            threadId: thread.id,
          }),
        },
      });
      expect(childAgent.status).toBe(500);
      expect(brokerCalls).toBe(2);
      const forged = await fetch(url, {
        ...init,
        headers: {
          ...init.headers,
          ...pluginApiHeaders({
            pluginId: permitted,
            key: pluginService.apiIdentities.keyFor(permitted),
          }),
          "x-patcher-credential-caller": randomUUID(),
        },
      });
      expect(forged.status).toBe(500);
      expect(brokerCalls).toBe(2);
    } finally {
      await pluginService.stop();
      await closeWebSockets();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}, 30_000);
