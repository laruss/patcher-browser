import { setTimeout as sleep } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { pendingInteractions as pendingInteractionTable } from "@patcher/db";
import {
  isConsentPendingInteraction,
  type ConsentPendingInteraction,
} from "@patcher/domain";
import { PendingInteractionLifecycle } from "../../src/services/interactions/pending-interactions.js";
import { builtinPluginSource } from "../../src/services/plugins/builtin-registry.js";
import { PATCHER_THREAD_ID_HEADER } from "@patcher/server-contract";
import type { AppDeps } from "../../src/types.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

/**
 * A plugin change an agent asked for has to be allowed by the user first.
 *
 * The gate is the declared thread, not the caller's identity — the server has
 * no way to check an identity here, since an agent's `patcher` invocation and
 * its user's reach the same loopback API with the same credentials. So these
 * tests drive the HTTP boundary with and without the header, which is exactly
 * the distinction the feature rests on.
 */

const GATED_PLUGIN = "secrets";

function seedConsentThread(deps: AppDeps, suffix: string) {
  const { host } = seedHostSession(deps, { id: `host-consent-${suffix}` });
  const { project } = seedProjectWithSource(deps, { hostId: host.id });
  const environment = seedEnvironment(deps, {
    hostId: host.id,
    projectId: project.id,
  });
  return seedThread(deps, {
    projectId: project.id,
    environmentId: environment.id,
  });
}

async function installDisabled(harness: TestAppHarness): Promise<string> {
  const entry = await harness.pluginService.install(
    builtinPluginSource(GATED_PLUGIN),
  );
  await harness.pluginService.setEnabled(entry.id, false);
  expect(isEnabled(harness, entry.id)).toBe(false);
  return entry.id;
}

function isEnabled(harness: TestAppHarness, pluginId: string): boolean {
  return (
    harness.pluginService.list().find((entry) => entry.id === pluginId)
      ?.enabled ?? false
  );
}

async function enableRequest(
  harness: TestAppHarness,
  pluginId: string,
  threadId?: string,
): Promise<Response> {
  return harness.app.request(`/api/v1/plugins/${pluginId}/enable`, {
    method: "POST",
    ...(threadId ? { headers: { [PATCHER_THREAD_ID_HEADER]: threadId } } : {}),
  });
}

/**
 * The prompt is raised inside the request the route is still serving, so the
 * interaction only exists once that request has reached the service. Polling
 * for it is the wait, rather than a sleep long enough to "probably" be enough.
 */
async function waitForConsentInteraction(
  harness: TestAppHarness,
  threadId: string,
): Promise<ConsentPendingInteraction> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [interaction] =
      harness.deps.pendingInteractions.listPendingThreadInteractions(threadId);
    if (interaction && isConsentPendingInteraction(interaction)) {
      return interaction;
    }
    await sleep(10);
  }
  throw new Error("No consent interaction was raised");
}

describe("plugin change consent", () => {
  it("enables without asking when no thread is declared", async () => {
    await withTestHarness(async (harness) => {
      const pluginId = await installDisabled(harness);

      const response = await enableRequest(harness, pluginId);

      expect(response.status).toBe(200);
      expect(isEnabled(harness, pluginId)).toBe(true);
      expect(
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          seedConsentThread(harness.deps, "unasked").id,
        ),
      ).toEqual([]);
    });
  });

  it("asks the thread's user, and enables once they allow it", async () => {
    await withTestHarness(async (harness) => {
      const pluginId = await installDisabled(harness);
      const thread = seedConsentThread(harness.deps, "allowed");

      const pending = enableRequest(harness, pluginId, thread.id);
      const interaction = await waitForConsentInteraction(harness, thread.id);

      expect(interaction.payload).toMatchObject({
        kind: "consent",
        action: "enable",
        subjectId: pluginId,
      });
      // The permissions are the reason to ask, so they have to reach the card.
      expect(Array.isArray(interaction.payload.permissions)).toBe(true);
      // Still off while the question stands.
      expect(isEnabled(harness, pluginId)).toBe(false);

      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        approved: true,
      });

      const response = await pending;
      expect(response.status).toBe(200);
      expect(isEnabled(harness, pluginId)).toBe(true);
    });
  });

  it("changes nothing when they decline, and says so without inviting a retry", async () => {
    await withTestHarness(async (harness) => {
      const pluginId = await installDisabled(harness);
      const thread = seedConsentThread(harness.deps, "declined");

      const pending = enableRequest(harness, pluginId, thread.id);
      const interaction = await waitForConsentInteraction(harness, thread.id);
      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        approved: false,
      });

      const response = await pending;
      expect(response.status).toBe(403);
      const body = (await response.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toContain("declined");
      expect(body.error).toContain("Do not retry");
      expect(isEnabled(harness, pluginId)).toBe(false);
    });
  });

  it("refuses rather than proceeds when the prompt cannot be shown", async () => {
    await withTestHarness(async (harness) => {
      const pluginId = await installDisabled(harness);

      // A thread that does not exist cannot be asked. Fail closed: a prompt
      // nobody saw is not consent.
      const response = await enableRequest(harness, pluginId, "thr_missing");

      expect(response.status).toBe(409);
      expect(isEnabled(harness, pluginId)).toBe(false);
    });
  });

  it("refuses a second change while the thread is already asking something", async () => {
    await withTestHarness(async (harness) => {
      const pluginId = await installDisabled(harness);
      const thread = seedConsentThread(harness.deps, "busy");

      const first = enableRequest(harness, pluginId, thread.id);
      const interaction = await waitForConsentInteraction(harness, thread.id);

      const second = await harness.app.request(
        `/api/v1/plugins/${pluginId}/disable`,
        {
          method: "POST",
          headers: { [PATCHER_THREAD_ID_HEADER]: thread.id },
        },
      );
      expect(second.status).toBe(409);

      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        approved: true,
      });
      expect((await first).status).toBe(200);
    });
  });

  it("asks before the store installs, which is the same door", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedConsentThread(harness.deps, "catalog");

      const pending = harness.app.request("/api/v1/plugin-catalog/install", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [PATCHER_THREAD_ID_HEADER]: thread.id,
        },
        body: JSON.stringify({ entryId: "patcher/docs" }),
      });
      const interaction = await waitForConsentInteraction(harness, thread.id);
      expect(interaction.payload.action).toBe("install");
      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        approved: false,
      });

      const response = await pending;
      expect(response.status).toBe(403);
      // The refusal comes before the catalog is even consulted, so a declined
      // install cannot half-happen.
      expect(
        harness.pluginService.list().some((entry) => entry.id === "docs"),
      ).toBe(false);
    });
  });

  it("asks before an update replaces a plugin's code", async () => {
    await withTestHarness(async (harness) => {
      const pluginId = await installDisabled(harness);
      const thread = seedConsentThread(harness.deps, "update");

      const pending = harness.app.request(
        `/api/v1/plugins/${pluginId}/update`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [PATCHER_THREAD_ID_HEADER]: thread.id,
          },
          body: JSON.stringify({}),
        },
      );
      const interaction = await waitForConsentInteraction(harness, thread.id);
      expect(interaction.payload.action).toBe("update");
      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        approved: false,
      });

      expect((await pending).status).toBe(403);
    });
  });

  it("sweeps a prompt that nothing can answer any more", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedConsentThread(harness.deps, "restart");
      const pending =
        harness.deps.pendingInteractions.requestConsentInteraction({
          threadId: thread.id,
          timeoutMs: 200,
          payload: {
            kind: "consent",
            action: "enable",
            subjectId: GATED_PLUGIN,
            subjectName: "Secrets",
            permissions: [],
            sites: [],
            detail: null,
          },
        });
      const [interaction] =
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          thread.id,
        );
      expect(interaction?.payload.kind).toBe("consent");

      // A new process over the same database. The promise that was awaiting the
      // answer lived in the old one, so an untouched row would leave a card on
      // screen with nothing behind it to decide anything.
      new PendingInteractionLifecycle(harness.deps).start();

      expect(
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          thread.id,
        ),
      ).toEqual([]);
      const [stored] = harness.db
        .select()
        .from(pendingInteractionTable)
        .where(eq(pendingInteractionTable.id, interaction!.id))
        .all();
      expect(stored?.originKind).toBe("server");
      expect(stored?.status).toBe("interrupted");
      expect(stored?.statusReason).toBe("server-restarted");

      // Drain the old waiter so its timer does not outlive the test.
      await expect(pending).resolves.toMatchObject({ outcome: "cancelled" });
    });
  });

  it("gives up on its own when nobody answers", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedConsentThread(harness.deps, "timeout");

      const result =
        await harness.deps.pendingInteractions.requestConsentInteraction({
          threadId: thread.id,
          timeoutMs: 20,
          payload: {
            kind: "consent",
            action: "enable",
            subjectId: GATED_PLUGIN,
            subjectName: "Secrets",
            permissions: [],
            sites: [],
            detail: null,
          },
        });

      expect(result).toEqual({ outcome: "cancelled", reason: "timeout" });
      expect(
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          thread.id,
        ),
      ).toEqual([]);
    });
  });
});
