import { describe, expect, it } from "vitest";
import { isConsentPendingInteraction } from "@patcher/domain";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { handleUpdateEnvironmentDirectoryToolCall } from "../../src/services/threads/thread-environment-directory.js";
import { turnUnmanagedPathRefusal } from "../../src/services/threads/workspace-path-claims.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

/**
 * Where a turn may point a workspace, which is where its next sandbox will be.
 *
 * `workspace: { type: "unmanaged", path }` and the `update_environment_directory`
 * tool both end in the same place: that directory becomes the writable root of
 * the next turn. A root of `/` bounds nothing, at any permission mode — the mode
 * says how the sandbox is built, not how wide it is.
 *
 * The checks beside this one are about sharing a directory safely (another
 * project's managed worktree, a live thread mid-checkout). None of them asks
 * whether the caller had any business naming the path, which is the question a
 * turn raises and a person does not.
 */

const HOST_ID = "host-workspace-path";
const SOURCE_PATH = "/Users/me/code/app";

describe("turnUnmanagedPathRefusal", () => {
  it("leaves a person alone, wherever they point", async () => {
    // Someone at their own machine choosing a folder is choosing where to work.
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: HOST_ID });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SOURCE_PATH,
      });

      expect(
        turnUnmanagedPathRefusal(harness.deps.db, {
          hostId: host.id,
          path: "/",
          projectId: project.id,
          projectSourcePaths: [SOURCE_PATH],
          requestedByThreadId: null,
        }),
      ).toBeNull();
    });
  });

  it("refuses a turn the whole filesystem, and says what to do instead", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: HOST_ID });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SOURCE_PATH,
      });

      const refusal = turnUnmanagedPathRefusal(harness.deps.db, {
        hostId: host.id,
        path: "/",
        projectId: project.id,
        projectSourcePaths: [SOURCE_PATH],
        requestedByThreadId: "thr_caller",
      });

      expect(refusal?.reason).toBe("outside-project");
      expect(refusal?.message).toContain(SOURCE_PATH);
      // The way forward is a person's click, so the message names it rather
      // than leaving an agent to guess or retry.
      expect(refusal?.message).toContain("project source");
    });
  });

  it("lets a turn work inside the project's own source, and under it", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: HOST_ID });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SOURCE_PATH,
      });

      for (const path of [SOURCE_PATH, `${SOURCE_PATH}/packages/web`]) {
        expect(
          turnUnmanagedPathRefusal(harness.deps.db, {
            hostId: host.id,
            path,
            projectId: project.id,
            projectSourcePaths: [SOURCE_PATH],
            requestedByThreadId: "thr_caller",
          }),
        ).toBeNull();
      }
    });
  });

  it("is not fooled by a sibling whose name starts the same", async () => {
    // `/Users/me/code/app-secrets` is not inside `/Users/me/code/app`, and a
    // prefix comparison would have said it was.
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: HOST_ID });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SOURCE_PATH,
      });

      expect(
        turnUnmanagedPathRefusal(harness.deps.db, {
          hostId: host.id,
          path: `${SOURCE_PATH}-secrets`,
          projectId: project.id,
          projectSourcePaths: [SOURCE_PATH],
          requestedByThreadId: "thr_caller",
        })?.reason,
      ).toBe("outside-project");
    });
  });

  it("lets a turn reuse a managed workspace the project already owns", async () => {
    // A worktree Patcher provisioned for this project sits outside the source
    // tree, and it is where a managed thread already works.
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: HOST_ID });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SOURCE_PATH,
      });
      const managedPath = "/Users/me/.patcher/worktrees/app-1";
      seedEnvironment(harness.deps, {
        hostId: host.id,
        path: managedPath,
        projectId: project.id,
        status: "ready",
      });

      expect(
        turnUnmanagedPathRefusal(harness.deps.db, {
          hostId: host.id,
          path: managedPath,
          projectId: project.id,
          projectSourcePaths: [SOURCE_PATH],
          requestedByThreadId: "thr_caller",
        }),
      ).toBeNull();
    });
  });

  it("says so plainly when the project has no source on this machine", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: HOST_ID });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SOURCE_PATH,
      });

      const refusal = turnUnmanagedPathRefusal(harness.deps.db, {
        hostId: host.id,
        path: "/tmp/somewhere",
        projectId: project.id,
        projectSourcePaths: [],
        requestedByThreadId: "thr_caller",
      });

      expect(refusal?.message).toContain("none registered here");
    });
  });
});

/**
 * The predicate above is only worth what its call sites are, and there are two —
 * a turn asking for a child thread at a path, and a turn moving the thread it is
 * already in. The second is the wider one and the one nothing named until now:
 * `update_environment_directory` is a tool the model calls itself, and no app or
 * CLI path does the same thing.
 */
describe("the two ways a turn can name a workspace", () => {
  it("refuses a child thread outside the project's sources", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-child-outside",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SOURCE_PATH,
      });

      // A real caller thread, because the create path now reads the project it
      // holds a turn to off the caller's own row rather than out of the body.
      const caller = seedThread(harness.deps, { projectId: project.id });

      await expect(
        createThreadFromRequest(
          harness.deps,
          {
            childOrigin: null,
            environment: {
              type: "host",
              hostId: host.id,
              workspace: { type: "unmanaged", path: "/" },
            },
            input: textInput("work everywhere"),
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            startedOnBehalfOf: null,
          },
          { requestedByThreadId: caller.id },
        ),
      ).rejects.toThrow(/project's own sources/);
    });
  });

  it("lets a person create the same thread", async () => {
    // The route stays as wide as it was for whoever is at the machine.
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-child-person",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SOURCE_PATH,
      });

      const thread = await createThreadFromRequest(
        harness.deps,
        {
          childOrigin: null,
          environment: {
            type: "host",
            hostId: host.id,
            workspace: { type: "unmanaged", path: "/tmp/anywhere-they-like" },
          },
          input: textInput("work here"),
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          startedOnBehalfOf: null,
        },
        { requestedByThreadId: null },
      );

      expect(thread.projectId).toBe(project.id);
    });
  });

  it("asks the person before the tool moves the turn out of the project", async () => {
    // Not `/`: the tool already refused the filesystem root by name, which is
    // the case that looks alarming and the only one it caught. Any other folder
    // outside the project — a home directory, someone else's checkout — went
    // through silently, and the next turn's writable root went with it.
    //
    // A refusal was the first attempt and it broke the tool's own purpose:
    // moving a thread to a checkout that is not a project source is what it is
    // for. So the widening is a question, and this asserts both halves of it.
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-move-tool" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SOURCE_PATH,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: SOURCE_PATH,
        projectId: project.id,
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });

      const pending = handleUpdateEnvironmentDirectoryToolCall(harness.deps, {
        currentEnvironment: environment,
        input: { path: "/Users/me/not-this-project" },
        thread,
        turnId: "turn-move",
      });
      const interaction = await waitForConsentInteraction(harness, thread.id);

      expect(interaction.payload.action).toBe("move-workspace");
      // The path is the subject, because the path is what the answer widens.
      expect(interaction.payload.subjectName).toBe(
        "/Users/me/not-this-project",
      );

      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        approved: false,
      });

      const result = await pending;
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).toContain("did not allow");
    });
  });

  it("asks nobody when the turn stays inside the project", async () => {
    // The prompt is about widening. Inside the sources there is nothing to
    // widen, so a prompt there would be noise a person learns to click through.
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-move-inside",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SOURCE_PATH,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        path: SOURCE_PATH,
        projectId: project.id,
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });

      void handleUpdateEnvironmentDirectoryToolCall(harness.deps, {
        currentEnvironment: environment,
        input: { path: `${SOURCE_PATH}/packages/web` },
        thread,
        turnId: "turn-move-inside",
      });

      // Give it the same window the other case needed to raise one.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          thread.id,
        ),
      ).toEqual([]);
    });
  });
});

async function waitForConsentInteraction(
  harness: TestAppHarness,
  threadId: string,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [interaction] =
      harness.deps.pendingInteractions.listPendingThreadInteractions(threadId);
    if (interaction && isConsentPendingInteraction(interaction)) {
      return interaction;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("No consent interaction was raised");
}
