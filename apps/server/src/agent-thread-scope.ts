import type { Context } from "hono";
import { getThread, type DbConnection } from "@patcher/db";
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
 * The thread id a `/api/v1/threads/:id...` path acts on, or null.
 *
 * Anchored on the `/threads/` segment rather than searched for, so a path that
 * merely contains the word — `/environments/:id/archive-threads` — is not read
 * as a thread route. `POST /threads` itself has no `:id` and is not one either:
 * creating a thread is bounded by what the new thread may then do.
 */
export function targetThreadIdFromPath(path: string): string | null {
  const match = /^\/api\/v1\/threads\/([^/]+)(?:\/|$)/u.exec(path);
  const id = match?.[1];
  return id === undefined || id.length === 0 ? null : decodeURIComponent(id);
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
