import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  isConsentPendingInteraction,
  type ConsentPendingInteraction,
} from "@patcher/domain";
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
