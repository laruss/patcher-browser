import { describe, expect, it } from "vitest";
import {
  recordEnvSetupScriptAllowance,
  recordEnvSetupScriptQuestion,
  listEnvSetupScriptConsents,
} from "@patcher/db";
import { projectSetupScriptConsentsResponseSchema } from "@patcher/server-contract";
import { readJson } from "../helpers/json.js";
import { seedHost, seedProjectWithSource } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

/**
 * The settings surface for a question the daemon asked in a thread nobody was
 * watching — and for the answers this install is still acting on.
 *
 * A schedule or a delegated thread provisions where no prompt can be answered,
 * so without this the same four minutes are spent asking nobody on every run.
 * Answering here is answering that prompt, which is why the mutations are not an
 * agent's (`agent-route-policy.ts`) and not a plugin's
 * (`plugin-api-identity.test.ts`).
 */

const SHA_ALLOWED = "a".repeat(64);
const SHA_ASKED = "b".repeat(64);

function seedProjectWithBothRecords(harness: TestAppHarness) {
  const host = seedHost(harness.deps, { id: "host-consents" });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/repos/thing",
  });
  recordEnvSetupScriptAllowance(harness.deps.db, harness.deps.hub, {
    projectId: project.id,
    hostId: host.id,
    sourcePath: "/repos/thing",
    scriptSha256: SHA_ALLOWED,
    scriptPath: "/repos/thing-wt/.patcher-env-setup.sh",
    scriptByteLength: 120,
  });
  recordEnvSetupScriptQuestion(harness.deps.db, harness.deps.hub, {
    projectId: project.id,
    hostId: host.id,
    sourcePath: "/repos/thing",
    scriptSha256: SHA_ASKED,
    scriptPath: "/repos/thing-wt/.patcher-env-setup.sh",
    scriptByteLength: 240,
  });
  return { host, project };
}

describe("a project's setup-script consents", () => {
  it("lists what is allowed and what is still waiting for an answer", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedProjectWithBothRecords(harness);

      const response = await harness.app.request(
        `/api/v1/projects/${project.id}/setup-script-consents`,
      );

      expect(response.status).toBe(200);
      const body = projectSetupScriptConsentsResponseSchema.parse(
        await readJson(response),
      );
      expect(body.consents).toHaveLength(2);
      // The machine and the checkout are in the row, because they are in the
      // answer: the same script allowed on one machine is not allowed on
      // another.
      expect(body.consents).toContainEqual(
        expect.objectContaining({
          status: "allowed",
          hostId: host.id,
          sourcePath: "/repos/thing",
          scriptSha256: SHA_ALLOWED,
          scriptByteLength: 120,
        }),
      );
      expect(body.consents).toContainEqual(
        expect.objectContaining({ status: "asked", scriptSha256: SHA_ASKED }),
      );
    });
  });

  it("allows a standing question, and forgets an allow that is taken back", async () => {
    await withTestHarness(async (harness) => {
      const { project } = seedProjectWithBothRecords(harness);
      const asked = listEnvSetupScriptConsents(
        harness.deps.db,
        project.id,
      ).find((consent) => consent.status === "asked");
      const allowed = listEnvSetupScriptConsents(
        harness.deps.db,
        project.id,
      ).find((consent) => consent.scriptSha256 === SHA_ALLOWED);

      const answered = await harness.app.request(
        `/api/v1/projects/${project.id}/setup-script-consents/${asked?.id}/allow`,
        { method: "POST" },
      );
      expect(answered.status).toBe(200);
      await expect(readJson(answered)).resolves.toMatchObject({
        id: asked?.id,
        status: "allowed",
      });

      const revoked = await harness.app.request(
        `/api/v1/projects/${project.id}/setup-script-consents/${allowed?.id}`,
        { method: "DELETE" },
      );
      expect(revoked.status).toBe(200);

      expect(listEnvSetupScriptConsents(harness.deps.db, project.id)).toEqual([
        expect.objectContaining({ id: asked?.id, status: "allowed" }),
      ]);
    });
  });

  it("will not answer for a row another project holds", async () => {
    await withTestHarness(async (harness) => {
      const { project } = seedProjectWithBothRecords(harness);
      const [someRow] = listEnvSetupScriptConsents(harness.deps.db, project.id);
      const otherHost = seedHost(harness.deps, { id: "host-elsewhere" });
      const { project: otherProject } = seedProjectWithSource(harness.deps, {
        hostId: otherHost.id,
        name: "Other",
        path: "/repos/other",
      });

      // The id alone is not the scope: a row is answered through the project
      // that holds it, or not at all.
      const response = await harness.app.request(
        `/api/v1/projects/${otherProject.id}/setup-script-consents/${someRow?.id}/allow`,
        { method: "POST" },
      );

      expect(response.status).toBe(404);
      expect(
        listEnvSetupScriptConsents(harness.deps.db, project.id).find(
          (consent) => consent.id === someRow?.id,
        )?.status,
      ).toBe(someRow?.status);
    });
  });
});
