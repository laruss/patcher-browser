import {
  getEnvironment,
  getHost,
  getSessionById,
  getThread,
  updateHost,
} from "@patcher/db";
import {
  createHostJoinCodeResponseSchema,
  type CreateHostJoinCodeResponse,
} from "@patcher/server-contract";
import {
  FIRST_PATCHER_ARTIFACT_PROTOCOL_VERSION,
  HOST_DAEMON_PROTOCOL_VERSION,
} from "@patcher/host-daemon-contract";
import { describe, expect, it, vi } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedPrimaryHost,
  seedProjectWithSource,
  seedSession,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const API = "/api/v1";

async function createJoinCode(
  app: Parameters<typeof requestJoinCode>[0],
): Promise<CreateHostJoinCodeResponse> {
  const response = await requestJoinCode(app);
  expect(response.status).toBe(201);
  return createHostJoinCodeResponseSchema.parse(await readJson(response));
}

function requestJoinCode(app: {
  request: (path: string, init?: RequestInit) => Promise<Response> | Response;
}): Promise<Response> {
  return Promise.resolve(
    app.request(`${API}/hosts/join-codes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
}

describe("public host management", () => {
  it("mints a join code that enrolls through the existing internal route", async () => {
    await withTestHarness(async (harness) => {
      const issued = await createJoinCode(harness.app);
      expect(issued.joinCode).toMatch(/^patcherde_/u);
      expect(issued.expiresAt).toBeGreaterThan(Date.now());
      expect(issued.expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
      // Minting must not create a host row — an unredeemed code would leave a
      // phantom offline machine in the Machines pane. The row is born at
      // enroll with the daemon-reported name.
      expect(getHost(harness.db, issued.hostId)).toBeNull();

      const enrollResponse = await harness.app.request(
        "/internal/hosts/enroll",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${issued.joinCode}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            hostId: issued.hostId,
            hostName: "Build Machine",
            hostType: "persistent",
          }),
        },
      );

      expect(enrollResponse.status).toBe(201);
      const enrolled = (await readJson(enrollResponse)) as { hostKey: string };
      expect(getHost(harness.db, issued.hostId)).toMatchObject({
        name: "Build Machine",
        type: "persistent",
      });

      const sessionResponse = await harness.app.request(
        "/internal/session/open",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${enrolled.hostKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            activeThreads: [],
            dataDir: "/tmp/remote-patcher",
            hostId: issued.hostId,
            hostName: "Build Machine",
            hostType: "persistent",
            instanceId: "instance-cloud-2",
            loadedEnvironments: [],
            platform: "linux",
            protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          }),
        },
      );
      expect(sessionResponse.status).toBe(201);
    });
  });

  it("stores a permission ceiling", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host_ceiling" });
      expect(getHost(harness.db, host.id)?.maxPermissionMode).toBe("full");

      const response = await harness.app.request(
        `${API}/hosts/${host.id}/permission-ceiling`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ maxPermissionMode: "accept-edits" }),
        },
      );

      expect(response.status).toBe(200);
      expect(await readJson(response)).toMatchObject({
        id: host.id,
        maxPermissionMode: "accept-edits",
      });
      expect(getHost(harness.db, host.id)?.maxPermissionMode).toBe(
        "accept-edits",
      );
    });
  });

  it("renames a host, broadcasts it, and rejects unknown or destroyed hosts", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host_rename" });
      const notifyHost = vi.spyOn(harness.hub, "notifyHost");

      const response = await harness.app.request(`${API}/hosts/${host.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "  Renamed Machine  " }),
      });

      expect(response.status).toBe(200);
      expect(await readJson(response)).toMatchObject({
        id: host.id,
        name: "Renamed Machine",
      });
      expect(getHost(harness.db, host.id)?.name).toBe("Renamed Machine");
      expect(notifyHost).toHaveBeenCalledWith(host.id, ["host-connected"]);

      const unknownResponse = await harness.app.request(
        `${API}/hosts/host_unknown`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Unknown" }),
        },
      );
      expect(unknownResponse.status).toBe(404);

      updateHost(harness.db, harness.hub, host.id, {
        destroyedAt: Date.now(),
      });
      const destroyedResponse = await harness.app.request(
        `${API}/hosts/${host.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Too Late" }),
        },
      );
      expect(destroyedResponse.status).toBe(404);
    });
  });

  it("queues a retry only for an older daemon awaiting an update", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host_retry_update" });

      const notNeeded = await harness.app.request(
        `${API}/hosts/${host.id}/retry-update`,
        { method: "POST" },
      );
      expect(notNeeded.status).toBe(409);

      updateHost(harness.db, harness.hub, host.id, {
        lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
      });
      const response = await harness.app.request(
        `${API}/hosts/${host.id}/retry-update`,
        { method: "POST" },
      );
      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({ ok: true });
      expect(harness.hub.takeHostProtocolUpdateRetry(host.id)).toBe(true);
      expect(harness.hub.takeHostProtocolUpdateRetry(host.id)).toBe(false);

      updateHost(harness.db, harness.hub, host.id, {
        lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION + 1,
      });
      const newerDaemon = await harness.app.request(
        `${API}/hosts/${host.id}/retry-update`,
        { method: "POST" },
      );
      expect(newerDaemon.status).toBe(409);
      expect(await readJson(newerDaemon)).toMatchObject({
        code: "host_cannot_self_update",
      });

      // Older than the install artifact's rename: the daemon asks for
      // /install/bb-app.tgz, which this server answers with 410, so a queued
      // retry could only fail again. Note the case above uses
      // HOST_DAEMON_PROTOCOL_VERSION - 1, which is still allowed to retry —
      // the artifact rename landed inside that version without a bump, so it
      // gets the benefit of the doubt.
      updateHost(harness.db, harness.hub, host.id, {
        lastRejectedProtocolVersion:
          FIRST_PATCHER_ARTIFACT_PROTOCOL_VERSION - 1,
      });
      const preRenameDaemon = await harness.app.request(
        `${API}/hosts/${host.id}/retry-update`,
        { method: "POST" },
      );
      expect(preRenameDaemon.status).toBe(409);
      expect(await readJson(preRenameDaemon)).toMatchObject({
        code: "host_must_re_enroll",
      });
      expect(harness.hub.takeHostProtocolUpdateRetry(host.id)).toBe(false);
    });
  });

  it("revokes host credentials, closes its live session, tombstones it, and preserves environments", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHost(harness.deps, { id: "host_primary" });
      seedPrimaryHost(harness.deps, primary.id);
      const host = seedHost(harness.deps, { id: "host_remove" });
      const session = seedSession(harness.deps, host.id);
      const socket = {
        close: vi.fn(),
        send: vi.fn(),
      };
      harness.hub.registerDaemon(session.id, host.id, socket);
      const project = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      }).project;
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const activeThread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });
      const hostKey = await harness.deps.machineAuth.issueDaemonHostKey({
        hostId: host.id,
        hostType: "persistent",
      });
      const enrollKey = await harness.deps.machineAuth.issueHostEnrollKey({
        enrollSource: "loopback",
        hostId: host.id,
        hostType: "persistent",
      });

      const response = await harness.app.request(`${API}/hosts/${host.id}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({ ok: true });
      await expect(
        harness.deps.machineAuth.verifyDaemonHostKey(hostKey),
      ).resolves.toBeNull();
      expect(harness.hub.hasDaemonForHost(host.id)).toBe(false);
      expect(socket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "session-close", reason: "expired" }),
      );
      expect(socket.close).toHaveBeenCalledWith(1000, "expired");
      expect(
        getSessionById(harness.db, { sessionId: session.id }),
      ).toMatchObject({
        status: "closed",
        closeReason: "expired",
      });
      expect(getHost(harness.db, host.id)?.destroyedAt).not.toBeNull();
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        id: environment.id,
        hostId: host.id,
      });
      expect(getThread(harness.db, activeThread.id)?.status).toBe("error");

      const staleEnrollResponse = await harness.app.request(
        "/internal/hosts/enroll",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${enrollKey.key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            hostId: host.id,
            hostName: host.name,
            hostType: "persistent",
          }),
        },
      );
      expect(staleEnrollResponse.status).toBe(401);

      const secondDelete = await harness.app.request(
        `${API}/hosts/${host.id}`,
        { method: "DELETE" },
      );
      expect(secondDelete.status).toBe(404);
    });
  });

  it("refuses to remove the primary host", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHost(harness.deps, { id: "host_primary" });
      seedPrimaryHost(harness.deps, primary.id);

      const response = await harness.app.request(`${API}/hosts/${primary.id}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({
        code: "primary_host_removal_refused",
      });
      expect(getHost(harness.db, primary.id)?.destroyedAt).toBeNull();
    });
  });
});
