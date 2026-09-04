import type { Context } from "hono";
import { getThread, type DbConnection } from "@patcher/db";
import { publicApiRoutes } from "@patcher/server-contract";
import { MAX_THREAD_HIERARCHY_DEPTH } from "./services/threads/thread-parent.js";

/**
 * Which threads a turn's agent may act on: its own, and the ones it delegated.
 *
 * The thread key proves *which* thread is calling, and until now nothing
 * compared that with the `:id` the request acts on — so a sandboxed turn could
 * `send` to any other thread on the install, including one running at Full
 * Access, and have that thread do what it was told. The credential named a
 * caller and bounded nothing.
 *
 * Descendants rather than the caller alone, because delegation is what agents
 * are given: `patcher thread spawn` creates a child and the parent then drives
 * it. A grandchild counts too — a manager delegating through a layer is the
 * same relationship one link further, and the hierarchy is depth-capped
 * anyway.
 *
 * Reads are not scoped. An agent that can read another thread learns what it
 * says, which is a smaller thing than making it act, and the app's own views
 * are built from the same routes.
 *
 * The `:id` in the path is not the only place a request names a thread, and
 * the three denials at the foot of this file are about the other one: a
 * creation body names a parent and a project, a fork body names its source,
 * and each of those decides what happens to a thread the caller never
 * addressed. The fork is also the case where there is no `:id` to read.
 */

export const AGENT_THREAD_ID_CONTEXT_KEY = "patcherAgentThreadId";

declare module "hono" {
  interface ContextVariableMap {
    [AGENT_THREAD_ID_CONTEXT_KEY]: string | undefined;
  }
}

export interface AgentThreadIdReader {
  get(key: typeof AGENT_THREAD_ID_CONTEXT_KEY): string | undefined;
}

/** Records the thread a verified agent request speaks for, for later routes. */
export function setAgentThreadId(context: Context, threadId: string): void {
  context.set(AGENT_THREAD_ID_CONTEXT_KEY, threadId);
}

/**
 * The thread this request is the agent of, or undefined for anyone else.
 *
 * The verified id, not the header: `thread-identity.ts` has already checked the
 * key against it by the time this is set.
 */
export function getAgentThreadId(
  context: AgentThreadIdReader,
): string | undefined {
  return context.get(AGENT_THREAD_ID_CONTEXT_KEY);
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The segments under `/threads/` that name an operation rather than a thread.
 *
 * Read off the route table rather than listed here, because the cost of missing
 * one is a route refused to every turn always: `POST /threads/fork` was, for
 * exactly this reason — the capture below read `fork` as a thread id, and no
 * turn owns a thread called that. Mount `/threads/import` tomorrow and it lands
 * in this set on its own; the alternative is a hand-written list that falls
 * behind the server, which is the mistake once already made here.
 *
 * Every group is scanned rather than `publicApiRoutes.threads` alone, because
 * which group a route is declared in is a filing decision and this is about the
 * path the router matches.
 *
 * A collection route is not thereby unscoped — it is scoped by what it names in
 * its body instead, which is where a route with no `:id` names a thread. See
 * `agentForkSourceThreadDenial`.
 */
const THREADS_COLLECTION_SEGMENTS: ReadonlySet<string> = new Set(
  Object.values(publicApiRoutes)
    .flatMap((group) => Object.values(group))
    .flatMap((route) => {
      const segment = /^\/threads\/([^/:]+)(?:\/|$)/u.exec(route.path)?.[1];
      return segment === undefined ? [] : [segment];
    }),
);

/**
 * The thread id a `/api/v1/threads/:id...` path acts on, or null.
 *
 * Anchored on the `/threads/` segment rather than searched for, so a path that
 * merely contains the word — `/environments/:id/archive-threads` — is not read
 * as a thread route. `POST /threads` itself has no `:id` and is not one either:
 * creating a thread is bounded by what the new thread may then do. Nor is a
 * collection route that names an operation in that position: see
 * `THREADS_COLLECTION_SEGMENTS`.
 */
export function targetThreadIdFromPath(path: string): string | null {
  const match = /^\/api\/v1\/threads\/([^/]+)(?:\/|$)/u.exec(path);
  const id = match?.[1];
  if (id === undefined || id.length === 0) return null;
  // The raw segment, because that is what the router matched on: `for%6b`
  // decodes to `fork` but reaches `/threads/:id`, and skipping the check for it
  // would be reading the encoding rather than the route.
  if (THREADS_COLLECTION_SEGMENTS.has(id)) return null;
  return decodeURIComponent(id);
}

/**
 * May this turn's agent act on that thread — its own, or one it spawned?
 *
 * Shared with the terminal scope: a terminal belongs to the thread it was
 * opened for, so "whose terminal is this to drive" is the same question one
 * indirection out.
 */
export function agentMayDriveThread(
  db: DbConnection,
  args: { callerThreadId: string; targetThreadId: string },
): boolean {
  return (
    args.targetThreadId === args.callerThreadId || isCallerAncestorOf(db, args)
  );
}

function isCallerAncestorOf(
  db: DbConnection,
  args: { callerThreadId: string; targetThreadId: string },
): boolean {
  // Bounded by the same cap the hierarchy is built under, and by a visited set,
  // so a cycle written by anything else cannot spin here.
  const visited = new Set<string>([args.targetThreadId]);
  let parentId = getThread(db, args.targetThreadId)?.parentThreadId ?? null;
  for (let step = 0; step < MAX_THREAD_HIERARCHY_DEPTH; step += 1) {
    if (parentId === null || visited.has(parentId)) return false;
    if (parentId === args.callerThreadId) return true;
    visited.add(parentId);
    parentId = getThread(db, parentId)?.parentThreadId ?? null;
  }
  return false;
}

export interface AgentThreadScopeDenial {
  /** The thread the request tried to act on, for logs and tests. */
  targetThreadId: string;
  /** What the caller is told: the reason, and the way to do it properly. */
  message: string;
}

export interface AgentThreadScopeDenialArgs {
  callerThreadId: string;
  method: string;
  path: string;
}

/**
 * Why this agent request must not act on that thread, or null when it may.
 *
 * Written for the agent that will read it: an agent told only "no" retries the
 * same call, so it says which thread it reached for and what it can do instead.
 */
export function agentThreadScopeDenial(
  db: DbConnection,
  args: AgentThreadScopeDenialArgs,
): AgentThreadScopeDenial | null {
  if (!MUTATION_METHODS.has(args.method.toUpperCase())) return null;
  const targetThreadId = targetThreadIdFromPath(args.path);
  if (targetThreadId === null) return null;
  if (
    agentMayDriveThread(db, {
      callerThreadId: args.callerThreadId,
      targetThreadId,
    })
  ) {
    return null;
  }
  return {
    targetThreadId,
    message: `Thread ${targetThreadId} is not this turn's to drive: a turn acts on its own thread and on the threads it spawned. Nothing changed. Spawn a thread of your own with \`patcher thread spawn\`, or ask in your reply for someone to act on that one.`,
  };
}

/**
 * Why this turn must not hang a thread under that parent, or null when it may.
 *
 * The same relationship as `agentMayDriveThread`, asked about a different
 * field. A parent is not a label: when a child's turn ends, Patcher dispatches
 * a turn on the parent carrying the child's title and output
 * (`parent-system-messages.ts`), at the parent's own permission mode and with
 * nobody having asked for it. So naming another thread as the parent is a way
 * to make that thread act — the thing the check above exists to refuse — one
 * indirection and one turn later, and `assertValidParentThread` was never
 * asking that question: it asks whether the parent is a live thread of the
 * right project at a workable depth, which a Full Access thread is.
 */
export function agentParentThreadDenial(
  db: DbConnection,
  args: { callerThreadId: string; parentThreadId: string },
): string | null {
  if (
    agentMayDriveThread(db, {
      callerThreadId: args.callerThreadId,
      targetThreadId: args.parentThreadId,
    })
  ) {
    return null;
  }
  return `Thread ${args.parentThreadId} is not this turn's to parent: a turn hangs a new thread under itself or under one it spawned, and a parent is sent a turn when its child finishes. Nothing changed. Use your own thread id — \`patcher thread spawn --parent-self\` fills it in for you.`;
}

/**
 * Why this turn must not fork that thread, or null when it may.
 *
 * The third field that names a thread the caller never addressed, and the one
 * the path check cannot see: a fork names its source in the body, because
 * `POST /threads/fork` has no `:id` to name it in.
 *
 * Asked at all because a fork is not a read. Reads are deliberately unscoped
 * above — an agent that can read another thread learns what it says — but a
 * fork clones the source's *provider session* into a thread the caller then
 * drives: the model's own context rather than the timeline, including the
 * agent-only inputs the timeline never shows, and with `--workspace reuse` the
 * source's environment as the new thread's own. Creation is bounded elsewhere
 * (the project comes from the source thread and `agentProjectDenial` refuses
 * another project's; the permission mode is clamped to the caller's ceiling),
 * so this is the remaining question: whose conversation.
 */
export function agentForkSourceThreadDenial(
  db: DbConnection,
  args: { callerThreadId: string; sourceThreadId: string },
): string | null {
  if (
    agentMayDriveThread(db, {
      callerThreadId: args.callerThreadId,
      targetThreadId: args.sourceThreadId,
    })
  ) {
    return null;
  }
  return `Thread ${args.sourceThreadId} is not this turn's to fork: a turn forks its own thread or one it spawned, and a fork continues that thread's conversation under the new thread. Nothing changed. Fork your own thread with \`patcher thread fork "$PATCHER_THREAD_ID"\`, or ask in your reply for someone to fork that one.`;
}

/**
 * Why this turn must not start a thread in that project, or null when it may.
 *
 * The project is not a filing label either: it is where the workspace check
 * looks for its answer. A turn may point a new thread at the project's own
 * registered sources (`workspace-path-claims.ts`), so a project read out of the
 * request body lets the caller choose which sources it is held to — and, with
 * the parent check above, which threads are in reach of being adopted. It is
 * read from the caller's own thread instead.
 */
export function agentProjectDenial(
  db: DbConnection,
  args: { callerThreadId: string; projectId: string },
): string | null {
  const callerThread = getThread(db, args.callerThreadId);
  if (callerThread?.projectId === args.projectId) return null;
  const own = callerThread === null ? "" : ` (${callerThread.projectId})`;
  return `Project ${args.projectId} is not this turn's to start a thread in: a turn starts threads in the project its own thread belongs to${own}. Nothing changed.`;
}
