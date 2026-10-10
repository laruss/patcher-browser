import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { PATCHER_APP_KEY_HEADER } from "@patcher/config/app-key";
import {
  findProtectedCredential,
  listProtectedCredentials,
  getInstalledPlugin,
} from "@patcher/db";
import { createApp } from "../../../src/server.js";
import {
  credentialMetadata,
  credentialSourceHash,
} from "../../../src/services/plugins/protected-credentials.js";
import type { DesktopSitePolicy } from "@patcher/domain/plugin-site-access";
import type { SealedCredential } from "@patcher/domain/protected-credentials";
import { TEST_APP_API_KEY, withTestHarness } from "../../helpers/test-app.js";

it("ships enabled, runs the actual manager in a child, and preserves user choices and two sealed accounts over restart/disable/reinstall", async () => {
  await withTestHarness(async (harness) => {
    const context = {
      tabId: "tab",
      url: "https://example.test/login?token=not-a-record-key",
      origin: "https://example.test",
      documentId: randomUUID(),
    };
    const policies = new Map<string, DesktopSitePolicy>();
    const vaultId = randomUUID();
    let locked = false;
    let pending: { input: any; resolve: (value: unknown) => void } | undefined;
    const operations: any[] = [];
    vi.spyOn(harness.deps.hub, "getBrowserHostSnapshot").mockReturnValue({
      connected: true,
      hostCount: 1,
      browserHostId: "fixture",
    });
    vi.spyOn(harness.deps.hub, "requestBrowserCommand").mockImplementation(
      async ({ message }) => ({
        type: "browser-command.response",
        requestId: message.requestId,
        outcome: { ok: true, value: { type: "url", url: context.url } },
      }),
    );
    const created = createApp(harness.deps, {
      runPluginOutOfProcess: () => true,
      requestSite: async (method, input) => {
        const body = input as any;
        if (method === "site.policy") {
          policies.set(body.pluginId, body);
          return true;
        }
        if (method === "site.confirm") return context;
        if (method === "site.context" || method === "site.prepare") {
          if (
            locked ||
            body.owners.some(
              (owner: any) =>
                !policies.get(owner.pluginId)?.enabled ||
                !policies.get(owner.pluginId)?.origins.includes(context.origin),
            )
          )
            throw Error("Refused");
          return { ...context, token: randomUUID(), hostWebContentsId: 12 };
        }
        return true;
      },
      requestCredentials: async (method, input, signal) => {
        if (method === "credential.context") return { origin: context.origin };
        operations.push(input);
        return new Promise((resolve) => {
          pending = { input, resolve };
          signal?.addEventListener(
            "abort",
            () => resolve({ result: { status: "cancelled" } }),
            { once: true },
          );
        });
      },
    });
    const { pluginService, pluginCatalogService, app } = created;
    const target = { tabId: context.tabId, origin: context.origin };
    const rpc = async (method: string, input: unknown) => {
      const response = await app.request(
        `/api/v1/plugins/password-manager/rpc/${method}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [PATCHER_APP_KEY_HEADER]: TEST_APP_API_KEY,
          },
          body: JSON.stringify(input),
        },
      );
      expect(response.status).toBe(200);
      return (await response.json()).result;
    };
    const approve = () => {
      const { input, resolve } = pending!;
      pending = undefined;
      const operation = input.request.operation;
      if (operation === "fill" || operation === "delete") {
        resolve({
          result: { status: operation === "fill" ? "filled" : "deleted" },
        });
        return;
      }
      const old = input.record as SealedCredential | undefined;
      const record: SealedCredential = {
        id: old?.id ?? input.draft.id,
        version: old ? old.version + 1 : 1,
        origin: context.origin,
        owner: input.owner,
        sourceHash: input.sourceHash,
        accountId: old?.accountId ?? input.request.accountId,
        username: old ? "updated-user" : input.request.accountId,
        protection: old?.protection ?? "confirm-each-time",
        createdAt: old?.createdAt ?? input.draft.createdAt,
        updatedAt: Date.now(),
        format: 1,
        vaultId,
        seal: "sealed-policy",
        nonce: "nonce",
        tag: "tag",
        ciphertext: "opaque-ciphertext",
      };
      resolve({
        result: {
          status: old ? "updated" : "saved",
          credential: credentialMetadata(record),
        },
        record,
      });
    };
    const manual = async (input: Record<string, unknown>) => {
      const result = rpc("request", {
        ...target,
        requestId: randomUUID(),
        ...input,
      });
      await vi.waitFor(() => expect(pending).toBeDefined());
      // App/plugin RPC remains pending and sees no plaintext while awaiting a person.
      approve();
      return result;
    };
    const fromPage = (method: string, input: unknown) =>
      pluginService.siteAccess!.pageRpc(
        "password-manager",
        randomUUID(),
        method,
        JSON.stringify(input),
        async () => {
          const lookup = pluginService.getRpcHandler(
            "password-manager",
            method,
          );
          if (lookup.outcome !== "found")
            throw Error("Missing manager handler");
          return pluginService.invokeRpcHandler(
            "password-manager",
            method,
            lookup.value,
            input,
          );
        },
      );
    try {
      await pluginService.start();
      const installed = pluginService
        .list()
        .find((item) => item.id === "password-manager");
      expect(installed).toMatchObject({
        id: "password-manager",
        status: "running",
        enabled: true,
        provenance: "builtin",
        placement: "process",
      });
      expect(await rpc("view", target)).toEqual({
        status: "denied",
        accounts: [],
      });
      await pluginService.siteAccess!.confirm("password-manager", "tab");
      expect(await fromPage("view", target)).toMatchObject({
        ok: true,
        result: { status: "denied", accounts: [] },
      });
      expect(
        await fromPage("request", {
          ...target,
          requestId: randomUUID(),
          operation: "save",
          accountId: "forged-page",
        }),
      ).toMatchObject({ ok: true, result: { status: "denied" } });
      expect(operations).toHaveLength(0);
      expect(
        await manual({ operation: "save", accountId: "personal" }),
      ).toEqual({ status: "saved" });
      expect(await manual({ operation: "save", accountId: "work" })).toEqual({
        status: "saved",
      });
      let view = await rpc("view", target);
      expect(
        view.accounts.map((account: any) => account.accountId).sort(),
      ).toEqual(["personal", "work"]);
      const work = view.accounts.find(
        (account: any) => account.accountId === "work",
      );
      const reference = { id: work.id, version: work.version };
      for (const operation of ["fill", "update", "delete"])
        expect(
          await fromPage("request", {
            ...target,
            requestId: randomUUID(),
            operation,
            reference,
          }),
        ).toMatchObject({ ok: true, result: { status: "denied" } });
      expect(operations).toHaveLength(2);
      expect(await manual({ operation: "fill", reference })).toEqual({
        status: "filled",
      });
      expect(await manual({ operation: "update", reference })).toEqual({
        status: "updated",
      });
      expect(
        await rpc("request", {
          ...target,
          requestId: randomUUID(),
          operation: "fill",
          reference,
        }),
      ).toEqual({ status: "denied" });
      view = await rpc("view", target);
      expect(
        view.accounts.find((account: any) => account.id === work.id).version,
      ).toBe(2);
      await pluginService.stop();
      await pluginService.start();
      expect((await rpc("view", target)).accounts).toHaveLength(2);
      await pluginService.setEnabled("password-manager", false);
      await pluginService.stop();
      await pluginService.start();
      expect(
        pluginService.list().find((item) => item.id === "password-manager"),
      ).toMatchObject({ enabled: false, status: "disabled" });
      expect(findProtectedCredential(harness.deps.db, work.id)).toBeDefined();
      await pluginService.setEnabled("password-manager", true);
      locked = true;
      expect(await rpc("view", target)).toEqual({
        status: "denied",
        accounts: [],
      });
      locked = false;
      await pluginService.siteAccess!.revoke(
        "password-manager",
        context.origin,
      );
      expect(await rpc("view", target)).toEqual({
        status: "denied",
        accounts: [],
      });
      await pluginService.siteAccess!.confirm("password-manager", "tab");
      expect(await pluginService.remove("password-manager")).toBe(true);
      await pluginService.stop();
      await pluginService.start();
      expect(
        pluginService.list().some((item) => item.id === "password-manager"),
      ).toBe(false);
      expect(findProtectedCredential(harness.deps.db, work.id)).toBeDefined();
      expect(
        await pluginCatalogService.search("password-manager"),
      ).toMatchObject([{ entryId: "password-manager", installed: false }]);
      expect(
        await pluginCatalogService.install("password-manager"),
      ).toMatchObject({
        id: "password-manager",
        enabled: true,
        provenance: "builtin",
        status: "running",
      });
      expect(await rpc("view", target)).toEqual({
        status: "denied",
        accounts: [],
      });
      await pluginService.siteAccess!.confirm("password-manager", "tab");
      expect((await rpc("view", target)).accounts).toHaveLength(2);
      expect(
        await manual({
          operation: "delete",
          reference: { id: work.id, version: 2 },
        }),
      ).toEqual({ status: "deleted" });
      expect((await rpc("view", target)).accounts).toHaveLength(1);
      const row = getInstalledPlugin(harness.deps.db, "password-manager")!;
      expect(
        JSON.stringify(
          listProtectedCredentials(
            harness.deps.db,
            row.id,
            credentialSourceHash(row),
            context.origin,
          ),
        ),
      ).not.toContain("token=not-a-record-key");
      expect(JSON.stringify(operations)).not.toContain('"password"');
    } finally {
      await pluginService.stop();
      created.closeWebSockets();
    }
  });
}, 60_000);
