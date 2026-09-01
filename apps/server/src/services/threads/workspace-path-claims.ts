import {
  findForeignManagedEnvironmentAtHostPath,
  findProjectEnvironmentByHostPath,
  hasLiveThreadAtHostPath,
  type DbConnection,
} from "@patcher/db";
import path from "node:path";
import { isPatcherManagedWorkspacePath } from "./worktree-paths.js";

/**
 * A workspace path is claimed per project: two projects may each hold their own
 * environment for one folder. Safety questions about the folder itself are not
 * project-scoped, though — the directory is shared physically. These helpers
 * answer those questions across every project.
 */

export interface UnmanagedAttachRefusal {
  reason: "foreign-managed" | "live-thread" | "outside-project";
  message: string;
}

export interface TurnUnmanagedPathCheckArgs {
  hostId: string;
  path: string;
  projectId: string;
  /** Every registered source path for this project on this machine. */
  projectSourcePaths: readonly string[];
  /** The turn that asked, or null when a person did. */
  requestedByThreadId: string | null;
}

export interface UnmanagedAttachCheckArgs {
  /** Host data directory, for recognizing Patcher's own workspace roots. */
  dataDir: string | null;
  /** Set when the request also checks out a branch, which rewrites the tree. */
  checksOutBranch: boolean;
  hostId: string;
  path: string;
  projectId: string;
}

/**
 * Why an unmanaged attach to this directory must be refused, or null when it is
 * safe. Two hazards survive project scoping:
 *
 * 1. The directory is a Patcher-managed workspace owned by another project. Cleanup
 *    of the owner deletes it out from under the attached thread. A managed
 *    environment stores its path only after the host reports success, so the
 *    row alone is not a reliable claim — Patcher's workspace roots close that
 *    window.
 * 2. A branch checkout rewrites the working tree while another project's agent
 *    is working in the same folder.
 */
export function unmanagedAttachRefusal(
  db: DbConnection,
  args: UnmanagedAttachCheckArgs,
): UnmanagedAttachRefusal | null {
  const foreignManagedMessage =
    "Workspace path is a Patcher-managed workspace owned by another project";

  if (
    findForeignManagedEnvironmentAtHostPath(db, {
      hostId: args.hostId,
      path: args.path,
      projectId: args.projectId,
    })
  ) {
    return { reason: "foreign-managed", message: foreignManagedMessage };
  }

  // A path under Patcher's workspace roots belongs to a managed environment even
  // when that environment has not stored its path yet.
  if (
    args.dataDir !== null &&
    isPatcherManagedWorkspacePath({ dataDir: args.dataDir, path: args.path }) &&
    !findProjectOwnsPath(db, args)
  ) {
    return { reason: "foreign-managed", message: foreignManagedMessage };
  }

  if (
    args.checksOutBranch &&
    hasLiveThreadAtHostPath(db, { hostId: args.hostId, path: args.path })
  ) {
    return {
      reason: "live-thread",
      message:
        "Cannot checkout branch while another thread is using this workspace",
    };
  }

  return null;
}

/**
 * Whether a turn may point the next thread's workspace at this directory.
 *
 * A person choosing a folder on their own machine is choosing where to work.
 * A turn choosing one is choosing its own next sandbox: `workspace: { type:
 * "unmanaged", path }` becomes the writable root of the thread it spawns, and a
 * writable root of `/` bounds nothing — at any permission mode, because the mode
 * only says how the sandbox is built, not how wide it is. The checks beside this
 * one cannot see that: they ask whether the directory is safe to share, not
 * whether the caller had any business naming it.
 *
 * So a turn is held to the project it is working in: the path has to be inside
 * one of the project's registered sources on that machine, or inside a
 * Patcher-managed workspace the project already owns. Both are places the person
 * put the project; neither is a place a turn can invent.
 *
 * A person is not held to it. This is the same split as `agent-thread-scope.ts`
 * and `agent-terminal-scope.ts`: the route stays as wide as it was for whoever
 * is at the machine, and narrows for the caller that is a turn.
 */
export function turnUnmanagedPathRefusal(
  db: DbConnection,
  args: TurnUnmanagedPathCheckArgs,
): UnmanagedAttachRefusal | null {
  if (args.requestedByThreadId === null) return null;
  if (findProjectOwnsPath(db, args)) return null;
  const sourcePaths = args.projectSourcePaths.filter(
    (sourcePath) => sourcePath.length > 0,
  );
  if (sourcePaths.some((sourcePath) => isPathInside(args.path, sourcePath))) {
    return null;
  }
  return {
    reason: "outside-project",
    message:
      sourcePaths.length > 0
        ? `A turn can only start a thread inside this project's own sources on this machine (${sourcePaths.join(", ")}), not at ${args.path}. Ask the person in the thread to add that folder as a project source first.`
        : `A turn can only start a thread inside this project's own sources on this machine, and this project has none registered here — so ${args.path} is not one. Ask the person in the thread to add it as a project source first.`,
  };
}

/** Whether `candidatePath` is `rootPath` or sits under it. */
function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

/**
 * A project may still attach to a Patcher-managed path it already owns — that is a
 * plain reuse of its own workspace, not a cross-project alias.
 */
function findProjectOwnsPath(
  db: DbConnection,
  args: Pick<UnmanagedAttachCheckArgs, "hostId" | "path" | "projectId">,
): boolean {
  return (
    findProjectEnvironmentByHostPath(
      db,
      args.projectId,
      args.hostId,
      args.path,
    ) !== null
  );
}
