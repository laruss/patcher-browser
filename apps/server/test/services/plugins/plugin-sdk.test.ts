import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConnection,
  getThread,
  migrate,
  type DbConnection,
} from "@patcher/db";
import { PERSONAL_PROJECT_ID } from "@patcher/domain";
import type { Logger } from "@patcher/logger";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import type { PatcherPluginApi } from "../../../src/services/plugins/plugin-api.js";
import {
  seedHostSession,
  seedEnvironment,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../../helpers/seed.js";
import { startTestServer, testLogger } from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;

async function writePlugin(
  dir: string,
  options: { name: string; serverSource: string },
): Promise<string> {
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      patcher: {
        name: "SDK fixture",
        description: "Plugin SDK fixture.",
        branding: { icon: "Zap" },
        permissions: ["threads", "workspace"],
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

function requireApi(
  service: PluginService,
  pluginId: string,
): PatcherPluginApi {
  const api = service.getApi(pluginId);
  if (!api) throw new Error(`plugin ${pluginId} is not running`);
  return api;
}

describe("plugin patcher.sdk bind gate", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;
  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "patcher-plugin-sdk-test-"));
    service = createPluginService({
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
      loadTimeoutMs: 2000,
    });
  });

  afterEach(async () => {
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("throws a descriptive error before bindSdk and resolves after", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "patcher-plugin-gate",
      serverSource: `export default function plugin() {}`,
    });
    await service.installPath(rootDir);
    const api = requireApi(service, "gate");

    expect(() => api.sdk).toThrow(
      /patcher\.sdk is not available until the server is listening/,
    );

    service.bindSdk({ baseUrl: "http://127.0.0.1:9" });
    expect(typeof api.sdk.threads.fork).toBe("function");
    expect(typeof api.sdk.threads.spawn).toBe("function");
  });

  it("marks a plugin error when its factory touches patcher.sdk at load time", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "patcher-plugin-eager",
      serverSource: `
        export default function plugin(patcher: any) {
          patcher.sdk.threads.spawn({});
        }
      `,
    });
    const entry = await service.installPath(rootDir);
    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain(
      "patcher.sdk is not available until the server is listening",
    );
  });
});

describe("plugin patcher.sdk against a running server", () => {
  it("keeps hidden plugin threads attributed and directly operable by id", async () => {
    const server = await startTestServer();
    const workDir = await mkdtemp(join(tmpdir(), "patcher-plugin-sdk-live-"));
    try {
      const { host } = seedHostSession(server.deps);
      seedPrimaryHost(server.deps, host.id);
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
        path: "/tmp/plugin-sdk-live-source",
      });
      const environment = seedEnvironment(server.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/plugin-sdk-live-source",
      });

      server.pluginService.bindSdk({ baseUrl: server.baseUrl });
      const rootDir = await writePlugin(workDir, {
        name: "patcher-plugin-spawner",
        serverSource: `export default function plugin() {}`,
      });
      const entry = await server.pluginService.installPath(rootDir);
      expect(entry.status).toBe("running");
      const api = requireApi(server.pluginService, "spawner");

      // A plain read proves the loopback SDK reaches this server instance.
      const projects = await api.sdk.projects.list();
      expect(projects.map((p) => p.id)).toContain(project.id);
      expect(projects.map((p) => p.id)).not.toContain(PERSONAL_PROJECT_ID);
      const projectsWithoutPersonal = await api.sdk.projects.list({
        includePersonal: false,
      });
      expect(projectsWithoutPersonal.map((p) => p.id)).toEqual([project.id]);

      const projectsWithPersonal = await api.sdk.projects.list({
        includePersonal: true,
      });
      expect(projectsWithPersonal.map((p) => p.id)).toEqual([
        PERSONAL_PROJECT_ID,
        project.id,
      ]);
      const projectsWithThreadsAndPersonal = await api.sdk.projects.list({
        include: "threads",
        includePersonal: true,
      });
      expect(projectsWithThreadsAndPersonal.map((p) => p.id)).toEqual([
        PERSONAL_PROJECT_ID,
        project.id,
      ]);
      expect(projectsWithThreadsAndPersonal).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: PERSONAL_PROJECT_ID, threads: [] }),
          expect.objectContaining({ id: project.id, threads: [] }),
        ]),
      );

      // Spawn with the server-resolved default environment. The plugin api
      // must fill in origin "plugin" + its own id without being asked.
      const thread = await api.sdk.threads.spawn({
        projectId: project.id,
        prompt: "spawned from a plugin",
        environment: { type: "project-default" },
        visibility: "hidden",
      });
      expect(thread.originPluginId).toBe("spawner");
      expect(thread.visibility).toBe("hidden");
      expect(getThread(server.db, thread.id)).toMatchObject({
        originPluginId: "spawner",
        visibility: "hidden",
      });
      await expect(
        api.sdk.threads.get({ threadId: thread.id }),
      ).resolves.toMatchObject({ id: thread.id, visibility: "hidden" });
      await expect(
        api.sdk.threads.wait({
          threadId: thread.id,
          status: "starting",
          timeoutMs: 100,
        }),
      ).resolves.toMatchObject({ matched: true, threadId: thread.id });
      await expect(
        api.sdk.threads.list({ projectId: project.id }),
      ).resolves.not.toContainEqual(expect.objectContaining({ id: thread.id }));
      await expect(
        api.sdk.threads.list({ projectId: project.id, includeHidden: true }),
      ).resolves.toContainEqual(expect.objectContaining({ id: thread.id }));

      const operable = seedThread(server.deps, {
        environmentId: environment.id,
        originPluginId: "spawner",
        projectId: project.id,
        status: "idle",
        visibility: "hidden",
      });
      seedThreadRuntimeState(server.deps, {
        environmentId: environment.id,
        inputText: "Initial turn",
        providerThreadId: "provider-hidden-plugin-thread",
        threadId: operable.id,
      });
      const fork = await api.sdk.threads.fork({
        sourceThreadId: operable.id,
        workspace: "reuse",
      });
      expect(fork).toMatchObject({
        originKind: "fork",
        originPluginId: "spawner",
        sourceThreadId: operable.id,
      });
      await expect(
        api.sdk.threads.wait({
          threadId: operable.id,
          status: "idle",
          timeoutMs: 100,
        }),
      ).resolves.toMatchObject({ matched: true });
      await expect(
        api.sdk.threads.send({
          threadId: operable.id,
          mode: "auto",
          input: [{ type: "text", text: "Continue", mentions: [] }],
        }),
      ).resolves.toEqual({ ok: true });
      await expect(
        api.sdk.threads.stop({ threadId: operable.id }),
      ).resolves.toEqual({ ok: true });
    } finally {
      await server.pluginService.stop();
      await rm(workDir, { recursive: true, force: true });
      await server.close();
    }
  });
});
