import type { Context } from "hono";
import type { AgentAccessCaller } from "./agent-access-identity.js";

/**
 * Which browser access grant a request came from, for the one route that has to
 * know.
 *
 * The same shape and the same reason as `plugin-api-identity-context.ts`: the
 * `/api/v1` gate has already verified the credential against the grant row and
 * held it to that row's lifetime, and re-deriving it at the route would be a
 * second thing to keep honest. What the route needs from it is not a permission
 * but the *level* — how far this particular grant reaches — which the gate has
 * no way to charge, because the level is per browser command and the command is
 * inside the request body.
 */

export const AGENT_ACCESS_CALLER_CONTEXT_KEY = "patcherAgentAccessCaller";

declare module "hono" {
  interface ContextVariableMap {
    [AGENT_ACCESS_CALLER_CONTEXT_KEY]: AgentAccessCaller | undefined;
  }
}

export interface AgentAccessCallerReader {
  get(
    key: typeof AGENT_ACCESS_CALLER_CONTEXT_KEY,
  ): AgentAccessCaller | undefined;
}

/** Records the grant a verified request speaks for, for later routes. */
export function setAgentAccessCaller(
  context: Context,
  caller: AgentAccessCaller,
): void {
  context.set(AGENT_ACCESS_CALLER_CONTEXT_KEY, caller);
}

/** The grant this request holds, or undefined for every other caller. */
export function getAgentAccessCaller(
  context: AgentAccessCallerReader,
): AgentAccessCaller | undefined {
  return context.get(AGENT_ACCESS_CALLER_CONTEXT_KEY);
}
