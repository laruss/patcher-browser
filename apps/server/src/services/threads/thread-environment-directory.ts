import { z } from "zod";
import {
  createEnvironment,
  createEventId,
  findProjectEnvironmentByHostPath,
  getEnvironment,
  getThread,
  listProjectSources,
  updateThread,
} from "@patcher/db";
import { turnScope } from "@patcher/domain";
import type {
  DynamicTool,
  Environment,
  Thread,
  ToolCallResponse,
} from "@patcher/domain";
import type { AppDeps } from "../../types.js";
import { CONSENT_INTERACTION_TIMEOUT_MS } from "../interactions/consent-text.js";
import { runLiveHostCommand } from "../hosts/live-command.js";
import { appendThreadEventInTransaction } from "./thread-events.js";
import { buildEnvironmentProvisionCommand } from "./thread-create-helpers.js";
import { findHostDataDir } from "../lib/entity-lookup.js";
import {
  turnUnmanagedPathRefusal,
  unmanagedAttachRefusal,
} from "./workspace-path-claims.js";

export const UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME =
  "update_environment_directory";

const UPDATE_ENVIRONMENT_DIRECTORY_TIMEOUT_MS = 5 * 60 * 1000;

const updateEnvironmentDirectoryInputSchema = z
  .object({
    path: z.string().trim().min(1),
  })
  .strict();

export const UPDATE_ENVIRONMENT_DIRECTORY_TOOL: DynamicTool = {
  name: UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME,
  description:
    "Move this Patcher thread to a different working directory for subsequent turns. Use this when the user asks to switch to a new checkout, worktree, or local directory. The path must be an absolute existing directory on the current host. The tool reuses this project's existing patcher environment for that host/path, otherwise it creates an unmanaged environment after validating the path. Another project may hold its own environment for the same directory; that is allowed, except for a Patcher-managed worktree owned by another project, which this tool refuses. After a successful switch, stop the current turn because the running provider cwd will not change until the next turn.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Absolute path to an existing directory on the current host.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

interface HandleUpdateEnvironmentDirectoryToolCallArgs {
  currentEnvironment: Environment;
  input: unknown;
  thread: Thread;
  turnId: string;
}

type ReadyEnvironment = Environment & { path: string; status: "ready" };

type AttachEnvironmentResult =
  | { kind: "attached"; changed: boolean }
  | { kind: "environment_changed" }
  | { kind: "thread_unavailable"; message: string };

function toolCallTextResponse(
  success: boolean,
  text: string,
): ToolCallResponse {
  return {
    success,
    contentItems: [{ type: "inputText", text }],
  };
}

function toolCallFailure(text: string): ToolCallResponse {
  return toolCallTextResponse(false, text);
}

function toolCallSuccess(text: string): ToolCallResponse {
  return toolCallTextResponse(true, text);
}

function normalizeDirectoryPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "/") {
    return trimmed;
  }
  return trimmed.replace(/\/+$/u, "");
}

function validateDirectoryPath(path: string): string | null {
  if (!path.startsWith("/")) {
    return "Path must be an absolute path on the current host.";
  }
  if (path === "/") {
    return "Path must name a project directory, not the filesystem root.";
  }
  if (path.includes("\0")) {
    return "Path must not contain NUL bytes.";
  }
  return null;
}

function threadWritableFailure(thread: Thread): string | null {
  if (thread.deletedAt !== null) {
    return "Cannot update the environment directory for a deleted thread.";
  }
  if (thread.archivedAt !== null) {
    return "Cannot update the environment directory for an archived thread.";
  }
  return null;
}

function readyEnvironmentFailure(environment: Environment): string | null {
  if (environment.status !== "ready") {
    return `Environment at this path is ${environment.status}, not ready.`;
  }
  if (!environment.path) {
    return "Environment at this path does not have a resolved directory.";
  }
  return null;
}

function asReadyEnvironment(environment: Environment): ReadyEnvironment | null {
  if (environment.status !== "ready" || !environment.path) {
    return null;
  }
  return {
    ...environment,
    path: environment.path,
    status: environment.status,
  };
}

function successMessage(path: string): string {
  return `Environment directory updated to ${path}. This applies to future turns; stop work in this turn so the next turn can run from the updated directory.`;
}

function attachReadyEnvironment(
  deps: Pick<AppDeps, "db" | "hub">,
  args: {
    currentEnvironment: Environment;
    createdEnvironment: boolean;
    targetEnvironment: ReadyEnvironment;
    thread: Thread;
    turnId: string;
  },
): AttachEnvironmentResult {
  const result = deps.db.transaction(
    (tx): AttachEnvironmentResult => {
      const latestThread = getThread(tx, args.thread.id);
      if (!latestThread || latestThread.deletedAt !== null) {
        return {
          kind: "thread_unavailable",
          message: "Thread no longer exists.",
        };
      }

      const writableFailure = threadWritableFailure(latestThread);
      if (writableFailure) {
        return { kind: "thread_unavailable", message: writableFailure };
      }

      if (latestThread.environmentId === args.targetEnvironment.id) {
        return { kind: "attached", changed: false };
      }

      if (latestThread.environmentId !== args.currentEnvironment.id) {
        return { kind: "environment_changed" };
      }

      updateThread(tx, deps.hub, latestThread.id, {
        environmentId: args.targetEnvironment.id,
      });
      appendThreadEventInTransaction(tx, {
        threadId: latestThread.id,
        environmentId: args.targetEnvironment.id,
        type: "system/operation",
        scope: turnScope(args.turnId),
        data: {
          operation: "environment_directory_update",
          operationId: createEventId(),
          status: "completed",
          message: `Updated environment directory to ${args.targetEnvironment.path}`,
          metadata: {
            createdEnvironment: args.createdEnvironment,
            previousEnvironmentId: args.currentEnvironment.id,
            previousPath: args.currentEnvironment.path,
            nextEnvironmentId: args.targetEnvironment.id,
            nextPath: args.targetEnvironment.path,
            workspaceProvisionType:
              args.targetEnvironment.workspaceProvisionType,
          },
        },
      });
      return { kind: "attached", changed: true };
    },
    { behavior: "immediate" },
  );

  if (result.kind === "attached" && result.changed) {
    deps.hub.notifyThread(args.thread.id, ["events-appended"], {
      eventTypes: ["system/operation"],
    });
  }

  return result;
}

async function provisionUnmanagedEnvironmentForPath(
  deps: AppDeps,
  args: {
    currentEnvironment: Environment;
    path: string;
    thread: Thread;
  },
): Promise<ReadyEnvironment | ToolCallResponse> {
  const environment = createEnvironment(deps.db, deps.hub, {
    projectId: args.thread.projectId,
    hostId: args.currentEnvironment.hostId,
    workspaceProvisionType: "unmanaged",
    managed: false,
    status: "provisioning",
  });
  const command = buildEnvironmentProvisionCommand({
    workspaceProvisionType: "unmanaged",
    environmentId: environment.id,
    hostId: args.currentEnvironment.hostId,
    initiator: null,
    path: args.path,
  });

  try {
    await runLiveHostCommand(deps, {
      hostId: args.currentEnvironment.hostId,
      command,
      timeoutMs: UPDATE_ENVIRONMENT_DIRECTORY_TIMEOUT_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolCallFailure(
      `Could not update environment directory to ${args.path}: ${message}`,
    );
  }

  const readyEnvironment = getEnvironment(deps.db, environment.id);
  if (!readyEnvironment) {
    return toolCallFailure("Prepared environment no longer exists.");
  }
  const failure = readyEnvironmentFailure(readyEnvironment);
  if (failure) {
    return toolCallFailure(failure);
  }
  const ready = asReadyEnvironment(readyEnvironment);
  if (!ready) {
    return toolCallFailure("Prepared environment is not ready.");
  }
  return ready;
}

/**
 * Ask the person before a turn moves its thread outside the project.
 *
 * Returns the tool failure to send back, or null when the move may proceed. The
 * timeout, the refusal wording and the "nobody could have seen it" cases are the
 * consent service's, not this file's — the same path the plugin prompts and the
 * setup script take.
 */
async function requestMoveWorkspaceConsent(
  deps: AppDeps,
  args: { path: string; threadId: string },
): Promise<ToolCallResponse | null> {
  if (!deps.pendingInteractions) {
    return toolCallFailure(
      `Cannot ask the user to allow ${args.path}: no interaction service is running. Nothing changed.`,
    );
  }
  let result;
  try {
    result = await deps.pendingInteractions.requestConsentInteraction({
      threadId: args.threadId,
      timeoutMs: CONSENT_INTERACTION_TIMEOUT_MS,
      payload: {
        kind: "consent",
        action: "move-workspace",
        subjectId: args.path,
        subjectName: args.path,
        permissions: [],
        sites: [],
        detail: `${args.path} is outside this project's registered sources on this machine.`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolCallFailure(
      `Could not ask the user about ${args.path}: ${message}. Nothing changed.`,
    );
  }
  if (result.outcome === "decided" && result.approved) {
    return null;
  }
  return toolCallFailure(
    result.outcome === "decided"
      ? `The user did not allow moving this thread to ${args.path}. Nothing changed — work in the project's own directories, or ask them to add that folder as a project source.`
      : `Nobody answered the request to move this thread to ${args.path} (${result.reason}). Nothing changed.`,
  );
}

export async function handleUpdateEnvironmentDirectoryToolCall(
  deps: AppDeps,
  args: HandleUpdateEnvironmentDirectoryToolCallArgs,
): Promise<ToolCallResponse> {
  const input = updateEnvironmentDirectoryInputSchema.safeParse(args.input);
  if (!input.success) {
    return toolCallFailure(
      "Invalid arguments. Provide an object with an absolute path string.",
    );
  }

  const normalizedPath = normalizeDirectoryPath(input.data.path);
  const pathFailure = validateDirectoryPath(normalizedPath);
  if (pathFailure) {
    return toolCallFailure(pathFailure);
  }

  const writableFailure = threadWritableFailure(args.thread);
  if (writableFailure) {
    return toolCallFailure(writableFailure);
  }

  if (args.currentEnvironment.path === normalizedPath) {
    return toolCallSuccess(
      `This thread is already using ${normalizedPath} as its environment directory.`,
    );
  }

  // The claim is project-scoped, but attaching in place to another project's
  // Patcher-managed worktree is unsafe: its cleanup deletes the directory.
  const refusal = unmanagedAttachRefusal(deps.db, {
    checksOutBranch: false,
    dataDir: findHostDataDir(deps, args.currentEnvironment.hostId),
    hostId: args.currentEnvironment.hostId,
    path: normalizedPath,
    projectId: args.thread.projectId,
  });
  if (refusal) {
    return toolCallFailure(`${refusal.message}. Use a different directory.`);
  }

  // This tool is the wider of the two ways a turn can choose where it runs: the
  // other one asks for a *child* thread at a path, and this one moves the thread
  // it is already in. Either way that directory becomes the writable root of
  // every turn after it.
  //
  // Refusing it outright was the first attempt and it was wrong: moving a thread
  // to a checkout that is *not* a project source is what this tool is for — "the
  // user asks you to move this thread to another directory" is its own
  // instruction — and two existing tests describe exactly that. So the widening
  // is a question rather than an error, asked of the person in the thread, the
  // way the repository's own setup script is. Inside the project's sources
  // nothing is asked.
  const outsideProject =
    turnUnmanagedPathRefusal(deps.db, {
      hostId: args.currentEnvironment.hostId,
      path: normalizedPath,
      projectId: args.thread.projectId,
      projectSourcePaths: listProjectSources(deps.db, args.thread.projectId)
        .filter(
          (source) =>
            source.hostId === args.currentEnvironment.hostId &&
            source.type === "local_path",
        )
        .map((source) => source.path),
      requestedByThreadId: args.thread.id,
    }) !== null;
  if (outsideProject) {
    const consent = await requestMoveWorkspaceConsent(deps, {
      path: normalizedPath,
      threadId: args.thread.id,
    });
    if (consent !== null) {
      return consent;
    }
  }

  const existingEnvironment = findProjectEnvironmentByHostPath(
    deps.db,
    args.thread.projectId,
    args.currentEnvironment.hostId,
    normalizedPath,
  );
  let createdEnvironment = false;
  let targetEnvironment: ReadyEnvironment;

  if (existingEnvironment) {
    const failure = readyEnvironmentFailure(existingEnvironment);
    if (failure) {
      return toolCallFailure(failure);
    }
    const ready = asReadyEnvironment(existingEnvironment);
    if (!ready) {
      return toolCallFailure("Environment at this path is not ready.");
    }
    targetEnvironment = ready;
  } else {
    const provisionedEnvironment = await provisionUnmanagedEnvironmentForPath(
      deps,
      {
        currentEnvironment: args.currentEnvironment,
        path: normalizedPath,
        thread: args.thread,
      },
    );

    if ("success" in provisionedEnvironment) {
      return provisionedEnvironment;
    }
    targetEnvironment = provisionedEnvironment;
    createdEnvironment = true;
  }

  const attachResult = attachReadyEnvironment(deps, {
    currentEnvironment: args.currentEnvironment,
    createdEnvironment,
    targetEnvironment,
    thread: args.thread,
    turnId: args.turnId,
  });

  switch (attachResult.kind) {
    case "attached":
      return toolCallSuccess(successMessage(targetEnvironment.path));
    case "environment_changed":
      return toolCallFailure(
        "Thread environment changed while preparing the new directory. Try again with the desired path.",
      );
    case "thread_unavailable":
      return toolCallFailure(attachResult.message);
  }
}
