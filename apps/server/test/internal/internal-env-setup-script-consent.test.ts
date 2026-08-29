import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  isConsentPendingInteraction,
  type ConsentPendingInteraction,
} from "@patcher/domain";
import { recordEnvSetupScriptApproval } from "@patcher/db";
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
 * The daemon runs a repository's `.patcher-env-setup.sh` on the host, outside
 * every sandbox, as the user — and the script is a tracked file an agent can
 * commit to. So it asks first, about the script's content, and remembers the
 * answer for that content alone.
 */

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function seedSetupScriptThread(harness: TestAppHarness, suffix: string) {
  const { host, session } = seedHostSession(harness.deps, {
    id: `host-setup-consent-${suffix}`,
  });
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
  });
  return { environment, project, session, thread };
}

async function askToRun(args: {
  harness: TestAppHarness;
  environmentId: string;
  sessionId: string;
  threadId: string;
  scriptSha256: string;
}): Promise<Response> {
  return args.harness.app.request(
    "/internal/session/env-setup-script-consent",
    {
      method: "POST",
      headers: internalAuthHeaders(args.harness),
      body: JSON.stringify({
        sessionId: args.sessionId,
        environmentId: args.environmentId,
        threadId: args.threadId,
        scriptPath: "/tmp/worktree/.patcher-env-setup.sh",
        scriptSha256: args.scriptSha256,
        scriptByteLength: 42,
      }),
    },
  );
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

describe("setup script consent", () => {
  it("asks about the script content, then remembers that answer", async () => {
    await withTestHarness(async (harness) => {
      const { environment, session, thread } = seedSetupScriptThread(
        harness,
        "remembered",
      );

      const pending = askToRun({
        harness,
        environmentId: environment.id,
        sessionId: session.id,
        threadId: thread.id,
        scriptSha256: SHA_A,
      });
      const interaction = await waitForConsentInteraction(harness, thread.id);

      expect(interaction.payload.action).toBe("run-setup-script");
      // The hash is what the allow is remembered against, so it is what the
      // prompt has to be about.
      expect(interaction.payload.subjectId).toBe(SHA_A);
      expect(interaction.payload.subjectName).toBe(".patcher-env-setup.sh");

      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        approved: true,
      });

      const response = await pending;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        outcome: "approved",
      });

      // The second worktree from the same repository asks nobody: the answer
      // came back without a prompt being raised at all.
      const again = await askToRun({
        harness,
        environmentId: environment.id,
        sessionId: session.id,
        threadId: thread.id,
        scriptSha256: SHA_A,
      });
      expect(again.status).toBe(200);
      await expect(readJson(again)).resolves.toEqual({ outcome: "approved" });
      expect(
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          thread.id,
        ),
      ).toEqual([]);
    });
  });

  it("sends the response head before anybody has decided", async () => {
    await withTestHarness(async (harness) => {
      const { environment, session, thread } = seedSetupScriptThread(
        harness,
        "streamed-head",
      );

      const response = await askToRun({
        harness,
        environmentId: environment.id,
        sessionId: session.id,
        threadId: thread.id,
        scriptSha256: SHA_A,
      });

      // Awaited above, and the question is still standing: the head does not
      // wait for the answer. A hop that wants an origin response head within
      // thirty seconds would otherwise tear this down mid-decision, and the
      // failure would look like "setup scripts never run" rather than an error.
      expect(response.status).toBe(200);
      const interaction = await waitForConsentInteraction(harness, thread.id);
      expect(interaction.status).toBe("pending");

      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        approved: true,
      });

      // And the answer arrives in the body afterwards.
      await expect(readJson(response)).resolves.toEqual({
        outcome: "approved",
      });
    });
  });

  it("asks again when the script changed", async () => {
    await withTestHarness(async (harness) => {
      const { environment, session, thread } = seedSetupScriptThread(
        harness,
        "changed",
      );

      const first = askToRun({
        harness,
        environmentId: environment.id,
        sessionId: session.id,
        threadId: thread.id,
        scriptSha256: SHA_A,
      });
      const approved = await waitForConsentInteraction(harness, thread.id);
      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: approved.id,
        approved: true,
      });
      await first;

      const second = askToRun({
        harness,
        environmentId: environment.id,
        sessionId: session.id,
        threadId: thread.id,
        scriptSha256: SHA_B,
      });
      const asked = await waitForConsentInteraction(harness, thread.id);
      expect(asked.payload.subjectId).toBe(SHA_B);

      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: asked.id,
        approved: false,
      });
      await expect(readJson(await second)).resolves.toEqual({
        outcome: "refused",
        reason: "you did not allow it",
      });
    });
  });

  it("refuses when they decline, and remembers nothing", async () => {
    await withTestHarness(async (harness) => {
      const { environment, session, thread } = seedSetupScriptThread(
        harness,
        "declined",
      );

      const pending = askToRun({
        harness,
        environmentId: environment.id,
        sessionId: session.id,
        threadId: thread.id,
        scriptSha256: SHA_A,
      });
      const interaction = await waitForConsentInteraction(harness, thread.id);
      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        approved: false,
      });

      await expect(readJson(await pending)).resolves.toEqual({
        outcome: "refused",
        reason: "you did not allow it",
      });

      // A declined script is not a remembered one: the same content asks again.
      const again = askToRun({
        harness,
        environmentId: environment.id,
        sessionId: session.id,
        threadId: thread.id,
        scriptSha256: SHA_A,
      });
      const second = await waitForConsentInteraction(harness, thread.id);
      expect(second.payload.subjectId).toBe(SHA_A);
      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: second.id,
        approved: false,
      });
      await again;
    });
  });

  it("takes a sibling provision's allow rather than refusing its own prompt", async () => {
    await withTestHarness(async (harness) => {
      const { environment, project, session, thread } = seedSetupScriptThread(
        harness,
        "sibling",
      );

      const pending = askToRun({
        harness,
        environmentId: environment.id,
        sessionId: session.id,
        threadId: thread.id,
        scriptSha256: SHA_A,
      });
      const interaction = await waitForConsentInteraction(harness, thread.id);

      // What a fanout looks like from here: several provisions of one
      // repository ask at once, all of them past the remembered-answer check
      // before any of them is answered. Somebody allows the one they are
      // looking at; this one ends without a decision of its own.
      recordEnvSetupScriptApproval(harness.deps.db, {
        projectId: project.id,
        scriptSha256: SHA_A,
      });
      harness.deps.pendingInteractions.cancelConsentInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        reason: "user",
      });

      // Allowing the script is allowing the script, so the sibling worktree
      // runs it too rather than skipping it over a prompt nobody answered
      // twice.
      await expect(readJson(await pending)).resolves.toEqual({
        outcome: "approved",
      });
    });
  });

  it("still refuses a decline, whatever a sibling allowed", async () => {
    await withTestHarness(async (harness) => {
      const { environment, project, session, thread } = seedSetupScriptThread(
        harness,
        "declined-wins",
      );

      const pending = askToRun({
        harness,
        environmentId: environment.id,
        sessionId: session.id,
        threadId: thread.id,
        scriptSha256: SHA_A,
      });
      const interaction = await waitForConsentInteraction(harness, thread.id);
      recordEnvSetupScriptApproval(harness.deps.db, {
        projectId: project.id,
        scriptSha256: SHA_A,
      });
      // A decline is a decision, not an absence of one, so it is not something
      // a remembered answer speaks for.
      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        approved: false,
      });

      await expect(readJson(await pending)).resolves.toEqual({
        outcome: "refused",
        reason: "you did not allow it",
      });
    });
  });

  it("refuses a thread that belongs to another environment", async () => {
    await withTestHarness(async (harness) => {
      const { session, thread } = seedSetupScriptThread(harness, "mismatch");

      const response = await askToRun({
        harness,
        environmentId: "env_not_this_one",
        sessionId: session.id,
        threadId: thread.id,
        scriptSha256: SHA_A,
      });

      expect(response.status).toBe(403);
      expect(
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          thread.id,
        ),
      ).toEqual([]);
    });
  });
});
