import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DesktopSitePolicy } from "@patcher/domain/plugin-site-access";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import { createMockHubSocket } from "../../helpers/mock-hub-socket.js";
import { runWithPluginSiteCallers } from "../../../src/services/browser/plugin-site-caller.js";

let harness: TestAppHarness | undefined;
afterEach(async () => {
  await harness?.pluginService.stop();
  await harness?.cleanup();
  harness = undefined;
});
describe.each([false, true])(
  "runtime site plugin through the real owner gate (child=%s)",
  (child) => {
    it("refuses without native grant, uses the new channel, and closes again on revoke", async () => {
      const policies = new Map<string, DesktopSitePolicy>();
      const context = {
        tabId: "tab",
        url: "https://example.com/",
        origin: "https://example.com",
        documentId: randomUUID(),
      };
      harness = await createTestAppHarness({
        runPluginOutOfProcess: () => child,
        requestSite: async (method, payload) => {
          const body = payload as Record<string, unknown>;
          if (method === "site.policy") {
            policies.set(body.pluginId as string, payload as DesktopSitePolicy);
            return true;
          }
          if (method === "site.confirm") return context;
          if (method === "site.cleanup") return [];
          if (
            method === "site.prepare" ||
            method === "site.context" ||
            method === "site.auth"
          ) {
            for (const owner of body.owners as Array<{
              pluginId: string;
              revision: string;
            }>) {
              const policy = policies.get(owner.pluginId);
              if (
                !policy?.enabled ||
                policy.revision !== owner.revision ||
                !policy.origins.includes(context.origin)
              )
                throw new Error("Denied by main");
            }
            return method === "site.auth"
              ? { token: randomUUID() }
              : { token: randomUUID(), ...context, hostWebContentsId: 12 };
          }
          return true;
        },
      });
      const root = join(harness.config.dataDir, "runtime-source");
      await mkdir(root);
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          name: "patcher-plugin-runtime-site",
          version: "0.1.0",
          engines: { patcherPluginSdk: ">=1.1.0" },
          patcher: {
            name: "Runtime fixture",
            description: "Fixture",
            branding: { icon: "Zap" },
            server: "./server.ts",
            siteAccess: "runtime",
            sites: ["https://example.com/**"],
            permissions: [
              "tabs.read",
              "auth.provide",
              "pageScript.register",
              "pageStyle.register",
            ],
          },
        }),
      );
      await writeFile(
        join(root, "server.ts"),
        `
      const schema = { "~standard": { version: 1, vendor: "fixture", validate: (value: unknown) => ({ value }) } };
      export default function(patcher: any) {
        let authCalls = 0;
        patcher.browser.registerAuthProvider(() => { authCalls++; return { username: "user", password: "sentinel" }; });
        patcher.rpc.register({ authCalls: { input: schema, output: schema } }, { authCalls: () => authCalls });
        patcher.browser.registerPageScript({ id: "script", matches: ["https://example.com/**"], code: "1" });
        patcher.rpc.register({ read: { input: schema, output: schema } }, { read: () => patcher.browser.page.getUrl({ tabId: "tab" }) });
      }
    `,
      );
      const entry = await harness.pluginService.installPath(root);
      expect([entry.status, entry.statusDetail]).toEqual(["running", null]);
      expect(harness.pluginService.listPageScriptContributions()).toEqual([]);
      const socket = createMockHubSocket(),
        current = harness;
      socket.send = (data) => {
        socket.messages.push(data);
        const message = JSON.parse(data) as { type: string; requestId: string };
        if (message.type === "browser-scoped-command-request")
          queueMicrotask(() =>
            current.hub.recordBrowserCommandResponse({
              socket,
              message: {
                type: "browser-command.response",
                requestId: message.requestId,
                outcome: { ok: true, value: { type: "url", url: context.url } },
              },
            }),
          );
      };
      harness.hub.registerBrowserHost(socket, {
        browserHostId: "host",
        nativeWebContentsId: 12,
      });
      async function read() {
        const lookup = current.pluginService.getRpcHandler(entry.id, "read");
        if (lookup.outcome !== "found") throw new Error(lookup.outcome);
        return current.pluginService.invokeRpcHandler(
          entry.id,
          "read",
          lookup.value,
          {},
        );
      }
      expect(await read()).toMatchObject({ ok: false });
      expect(socket.messages).toEqual([]);
      const authChallenge = {
        tabId: "tab",
        host: "example.com",
        insecure: false,
      };
      expect(
        await current.pluginService.resolveBrowserAuth({
          challenge: authChallenge,
          runtimePromptId: "prompt",
        }),
      ).toBeNull();
      await harness.pluginService.siteAccess!.confirm(entry.id, "tab");
      expect(
        await current.pluginService.resolveBrowserAuth({
          challenge: authChallenge,
        }),
      ).toBeNull();
      expect(
        await current.pluginService.resolveBrowserAuth({
          challenge: authChallenge,
          runtimePromptId: "prompt",
        }),
      ).toEqual({
        username: "user",
        password: "sentinel",
        token: expect.any(String),
      });
      expect(await read()).toEqual({ ok: true, result: context.url });
      expect(socket.messages.map((data) => JSON.parse(data).type)).toEqual([
        "browser-scoped-command-request",
      ]);
      // A granted target plugin cannot act as a deputy for an ungranted runtime parent.
      expect(
        await runWithPluginSiteCallers(["ungranted-parent"], read),
      ).toMatchObject({ ok: false });
      await harness.pluginService.siteAccess!.revoke(entry.id, context.origin);
      expect(await read()).toMatchObject({ ok: false });
      expect(
        await current.pluginService.resolveBrowserAuth({
          challenge: authChallenge,
          runtimePromptId: "prompt",
        }),
      ).toBeNull();
      const calls = current.pluginService.getRpcHandler(entry.id, "authCalls");
      if (calls.outcome !== "found") throw new Error(calls.outcome);
      expect(
        await current.pluginService.invokeRpcHandler(
          entry.id,
          "authCalls",
          calls.value,
          {},
        ),
      ).toEqual({ ok: true, result: 1 });
      expect(socket.messages).toHaveLength(1);
    }, 30_000);
  },
);
