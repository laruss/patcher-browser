import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  isConsentPendingInteraction,
  type ConsentPendingInteraction,
} from "@patcher/domain";
import { getAppSettings, setAppSettings } from "@patcher/db";
import { internalAuthHeaders } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

/**
 * A host a network-confined turn wants and nobody has allowed.
 *
 * The daemon's proxy is holding an agent's connection while this is asked, and
 * that connection will usually be gone before an answer arrives — so what the
 * route has to get right is not speed but *which answer is which*: a decision
 * either way is remembered by the daemon, and "nobody answered" is not.
 */

function seedEgressThread(harness: TestAppHarness, suffix: string) {
  const { host, session } = seedHostSession(harness.deps, {
    id: `host-egress-consent-${suffix}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/test-project",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
  });
  return { environment, host, project, session, thread };
}

async function askToReach(args: {
  harness: TestAppHarness;
  sessionId: string;
  threadId: string;
  host?: string;
  port?: number;
}): Promise<Response> {
  return args.harness.app.request("/internal/session/egress-host-consent", {
    method: "POST",
    headers: internalAuthHeaders(args.harness, {}),
    body: JSON.stringify({
      sessionId: args.sessionId,
      threadId: args.threadId,
      providerId: "acp-cursor",
      host: args.host ?? "registry.npmjs.org",
      port: args.port ?? 443,
    }),
  });
}

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

describe("egress host consent", () => {
  it("asks about the host, and allowing says so", async () => {
    await withTestHarness(async (harness) => {
      const { session, thread } = seedEgressThread(harness, "allowed");

      const pending = askToReach({
        harness,
        sessionId: session.id,
        threadId: thread.id,
      });
      const interaction = await waitForConsentInteraction(harness, thread.id);

      // The hostname is the identity and the whole of what is allowed: it is
      // what the proxy decides on, so it is what the prompt is about.
      expect(interaction.payload.action).toBe("reach-host");
      expect(interaction.payload.subjectName).toBe("registry.npmjs.org");
      expect(interaction.payload.detail).toContain("acp-cursor");
      expect(interaction.payload.detail).toContain("443");

      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        approved: true,
      });

      const response = await pending;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        outcome: "allowed",
      });
    });
  });

  it("tells a decline apart from nobody answering", async () => {
    await withTestHarness(async (harness) => {
      const { session, thread } = seedEgressThread(harness, "declined");

      const pending = askToReach({
        harness,
        sessionId: session.id,
        threadId: thread.id,
      });
      const interaction = await waitForConsentInteraction(harness, thread.id);
      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        approved: false,
      });

      // `declined` rather than `unanswered`, and the difference is the whole
      // reason there are three outcomes: the daemon remembers a decision, so
      // an agent that retries cannot put this prompt back on screen, while a
      // timeout leaves the host askable again next time.
      const response = await pending;
      await expect(readJson(response)).resolves.toEqual({
        outcome: "declined",
      });
    });
  });

  it("answers a host the person has since added without asking again", async () => {
    await withTestHarness(async (harness) => {
      const { session, thread } = seedEgressThread(harness, "already-allowed");
      setAppSettings(harness.deps.db, {
        ...getAppSettings(harness.deps.db),
        providerEgressAllowedHosts: ["*.npmjs.org"],
      });

      const response = await askToReach({
        harness,
        sessionId: session.id,
        threadId: thread.id,
      });

      // The daemon's list is only as fresh as the launch it was built for, so
      // Settings is re-read here: a host added mid-turn is not a question.
      await expect(readJson(response)).resolves.toEqual({
        outcome: "allowed",
      });
      expect(
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          thread.id,
        ),
      ).toEqual([]);
    });
  });

  it("says nobody could be asked when the thread is already holding a question", async () => {
    await withTestHarness(async (harness) => {
      const { session, thread } = seedEgressThread(harness, "busy-thread");

      const first = askToReach({
        harness,
        sessionId: session.id,
        threadId: thread.id,
        host: "one.example.com",
      });
      await waitForConsentInteraction(harness, thread.id);

      const second = await askToReach({
        harness,
        sessionId: session.id,
        threadId: thread.id,
        host: "two.example.com",
      });

      // A thread shows one prompt at a time, which is what keeps an agent from
      // filling the screen with hosts. The second host is not refused as a
      // decision — it is reported as unaskable, so the daemon does not
      // remember it and the next attempt can ask.
      const body = (await readJson(second)) as {
        outcome: string;
        reason: string;
      };
      expect(body.outcome).toBe("unanswered");
      expect(body.reason).toContain("could not be put to anyone");

      const interaction = await waitForConsentInteraction(harness, thread.id);
      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        approved: false,
      });
      await first;
    });
  });
});
