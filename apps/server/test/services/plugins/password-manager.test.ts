import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { PATCHER_APP_KEY_HEADER } from "@patcher/config/app-key";
import { findProtectedCredential, getInstalledPlugin } from "@patcher/db";
import {
  passwordStorePageSchema,
  passwordStoreStatusSchema,
  type ManagerCredential,
} from "@patcher/domain/password-manager";
import { createApp } from "../../../src/server.js";
import { createPasswordManagerStore } from "../../../src/services/plugins/password-manager-store.js";
import { credentialSourceHash } from "../../../src/services/plugins/protected-credentials.js";
import { TEST_APP_API_KEY, withTestHarness } from "../../helpers/test-app.js";

it("ships an enabled child-process switch, exposes no manager RPC, and preserves choices and sealed accounts over restart/disable/reinstall", async () => {
  await withTestHarness(async (harness) => {
    const requestCredentials = vi.fn(async () => {
      throw Error("The plugin must not request credentials");
    });
    const created = createApp(harness.deps, {
      runPluginOutOfProcess: () => true,
      requestSite: async () => true,
      requestCredentials,
    });
    const { pluginService, pluginCatalogService, app } = created;
    const store = createPasswordManagerStore(harness.deps.db);
    try {
      await pluginService.start();
      expect(
        pluginService.list().find((item) => item.id === "password-manager"),
      ).toMatchObject({
        id: "password-manager",
        status: "running",
        enabled: true,
        provenance: "builtin",
        placement: "process",
      });
      const installed = getInstalledPlugin(
        harness.deps.db,
        "password-manager",
      )!;
      const sourceHash = credentialSourceHash(installed);
      expect(await store({ operation: "status" })).toEqual({
        enabled: true,
        sourceHash,
      });
      for (const method of ["view", "request"]) {
        const response = await app.request(
          `/api/v1/plugins/password-manager/rpc/${method}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              [PATCHER_APP_KEY_HEADER]: TEST_APP_API_KEY,
            },
            body: JSON.stringify({ operation: "reveal" }),
          },
        );
        expect(response.status).toBe(404);
      }
      const vaultId = randomUUID();
      const records: ManagerCredential[] = ["personal", "work"].map(
        (username) => ({
          id: randomUUID(),
          version: 1,
          origin: "https://example.test",
          owner: installed.id,
          sourceHash,
          accountId: randomUUID(),
          username,
          protection: "system-auth",
          createdAt: 1,
          updatedAt: 1,
          format: 2,
          vaultId,
          seal: "sealed-policy",
          nonce: "nonce",
          tag: "tag",
          ciphertext: "opaque-ciphertext",
        }),
      );
      for (const record of records)
        await store({ operation: "put", sourceHash, record });
      const list = async () =>
        passwordStorePageSchema.parse(
          await store({ operation: "list", sourceHash }),
        ).records;
      expect((await list()).map((record) => record.username).sort()).toEqual([
        "personal",
        "work",
      ]);
      const work = records[1]!;
      const updated = {
        ...work,
        username: "updated-user",
        version: 2,
        updatedAt: 2,
      };
      await store({
        operation: "put",
        sourceHash,
        previousVersion: 1,
        record: updated,
      });
      expect((await list()).find((record) => record.id === work.id)).toEqual(
        updated,
      );

      await pluginService.stop();
      await pluginService.start();
      expect(await list()).toHaveLength(2);
      await pluginService.setEnabled("password-manager", false);
      await pluginService.stop();
      await pluginService.start();
      expect(
        pluginService.list().find((item) => item.id === "password-manager"),
      ).toMatchObject({ enabled: false, status: "disabled" });
      expect(await store({ operation: "status" })).toEqual({ enabled: false });
      await expect(list()).rejects.toThrow();
      expect(findProtectedCredential(harness.deps.db, work.id)?.record).toEqual(
        updated,
      );
      await pluginService.setEnabled("password-manager", true);
      expect(await list()).toHaveLength(2);

      expect(await pluginService.remove("password-manager")).toBe(true);
      await pluginService.stop();
      await pluginService.start();
      expect(
        pluginService.list().some((item) => item.id === "password-manager"),
      ).toBe(false);
      expect(await store({ operation: "status" })).toEqual({ enabled: false });
      expect(findProtectedCredential(harness.deps.db, work.id)?.record).toEqual(
        updated,
      );
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
      expect(
        passwordStoreStatusSchema.parse(await store({ operation: "status" })),
      ).toMatchObject({ enabled: true, sourceHash, vault: { vaultId } });
      expect(await list()).toHaveLength(2);
      await store({ operation: "delete", sourceHash, id: work.id, version: 2 });
      expect(await list()).toEqual([records[0]]);
      expect(requestCredentials).not.toHaveBeenCalled();
    } finally {
      await pluginService.stop();
      created.closeWebSockets();
    }
  });
}, 60_000);
