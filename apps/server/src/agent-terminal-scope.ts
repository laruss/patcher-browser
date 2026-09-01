import { getTerminalSession, type DbConnection } from "@patcher/db";
import { agentMayDriveThread } from "./agent-thread-scope.js";

/**
 * Which terminals a turn's agent may drive: the ones opened for its own thread,
 * and for the threads it spawned.
 *
 * `/terminals` used to be refused to an agent outright, and the reason was
 * true: a terminal is a PTY on the host, running as the user, outside the turn's
 * sandbox — the shortest way out that existed. What changed is the terminal, not
 * the judgement. One an agent opens now runs inside the same boundary its turn
 * runs in (`terminals/terminal-sandbox.ts` in the daemon), so the route is worth
 * having back; this is the other half of that, because a sandboxed terminal
 * belonging to somebody else's thread would still be somebody else's shell.
 *
 * Reads stay open, the same way thread reads do: seeing what a terminal printed
 * is a smaller thing than typing into it, and the app's own views are built from
 * those routes.
 */

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The terminal id a `/api/v1/terminals/:id...` path acts on, or null.
 *
 * `POST /terminals` has no `:id` and is not one: creating a terminal is checked
 * where the target is known, in the lifecycle service that builds it.
 */
export function targetTerminalIdFromPath(path: string): string | null {
  const match = /^\/api\/v1\/terminals\/([^/]+)(?:\/|$)/u.exec(path);
  const id = match?.[1];
  return id === undefined || id.length === 0 ? null : decodeURIComponent(id);
}

export interface AgentTerminalScopeDenial {
  /** The terminal the request tried to act on, for logs and tests. */
  terminalId: string;
  /** What the caller is told: the reason, and what it can do instead. */
  message: string;
}

export interface AgentTerminalScopeDenialArgs {
  callerThreadId: string;
  method: string;
  path: string;
}

/** Why this agent request must not act on that terminal, or null when it may. */
export function agentTerminalScopeDenial(
  db: DbConnection,
  args: AgentTerminalScopeDenialArgs,
): AgentTerminalScopeDenial | null {
  if (!MUTATION_METHODS.has(args.method.toUpperCase())) return null;
  const terminalId = targetTerminalIdFromPath(args.path);
  if (terminalId === null) return null;
  const terminal = getTerminalSession(db, { kind: "terminal", terminalId });
  const threadId = terminal?.threadId ?? null;
  if (
    terminal?.sandboxed === true &&
    threadId !== null &&
    agentMayDriveThread(db, {
      callerThreadId: args.callerThreadId,
      targetThreadId: threadId,
    })
  ) {
    return null;
  }
  // A person's terminal is refused whoever it belongs to, and the message says
  // which of the two things is wrong, because an agent told only "no" retries.
  const reason =
    terminal !== null && !terminal.sandboxed
      ? "it runs outside this turn's sandbox, because a person opened it"
      : "a turn drives the terminals of its own thread and of the threads it spawned";
  return {
    terminalId,
    message: `Terminal ${terminalId} is not this turn's to drive: ${reason}. Nothing changed. Open one of your own with \`patcher terminal create --self\`.`,
  };
}
