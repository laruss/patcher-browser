import {
  parseAgentAccessCredential,
  verifyAgentAccessKey,
} from "@patcher/config/agent-access-key";
import {
  getBrowserAccessGrant,
  touchBrowserAccessGrantUse,
  type DbConnection,
} from "@patcher/db";
import type { BrowserAccessGrantLevel } from "@patcher/domain";
import { PATCHER_AGENT_KEY_HEADER } from "@patcher/server-contract";

/**
 * Who is calling `/api/v1` from an agent that is not Patcher's.
 *
 * The fourth answer, beside `plugin-api-identity.ts` (a plugin),
 * `thread-identity.ts` (a turn) and `app-identity.ts` (the app, the CLI, the
 * launcher — anything holding the app key). It exists because the third answer
 * was doing work it could not do: Claude Code at a terminal, a script, and the
 * person themselves all arrive holding the app key, so "an agent outside
 * Patcher" was a caller the server could describe but not identify, and the
 * setting that decided what it may do was a setting that same caller could
 * write.
 *
 * A grant credential fixes the identification. It names one grant, it verifies
 * only against that grant's id, and — with `agent-access-route-policy.ts` — it
 * reaches two routes rather than the API. So an agent that presents one *is*
 * the thing the browser level talks about, and an agent that wants more than
 * the browser has to go and find the app key, which is a deliberate act rather
 * than the way the product works.
 *
 * **Genuine is not the same as accepted**, the same distinction the thread
 * identity draws. A credential's lifetime is the row it names: present while
 * the grant exists and `revokedAt` is null. That is deliberately a state a
 * person can see and end — the string itself lives in somebody's MCP config
 * forever, and revoking is what stops it.
 *
 * **Why a result rather than a nullable caller.** A refused grant would
 * otherwise fall through to the app-key check and come back as a bare 401,
 * which tells an agent nothing about what to do — and the one thing worth
 * saying here is exactly the thing the agent cannot see: the grant was taken
 * back. So a presented-and-wrong credential is distinguished from no credential
 * at all, and the middleware answers with the reason.
 */

export interface AgentAccessCaller {
  /** The grant this credential names, which is also the row that ends it. */
  grantId: string;
  /** What the person called it, for a refusal and a log to name. */
  label: string;
  /** How far this grant reaches, charged per browser command. */
  level: BrowserAccessGrantLevel;
}

export type AgentAccessResolution =
  /** No grant credential presented. Every other caller lands here. */
  | { kind: "none" }
  /** A live grant. */
  | { kind: "accepted"; caller: AgentAccessCaller }
  /** A grant credential that this install will not accept, and why. */
  | { kind: "refused"; reason: string };

export interface AgentAccessIdentity {
  resolve(request: AgentAccessKeyCarrier): AgentAccessResolution;
}

/** The part of a request this reads. Narrow so tests need no Hono context. */
export interface AgentAccessKeyCarrier {
  header(name: string): string | undefined;
}

export interface CreateAgentAccessIdentityArgs {
  appApiKey: string;
  db: DbConnection;
}

export function createAgentAccessIdentity(
  args: CreateAgentAccessIdentityArgs,
): AgentAccessIdentity {
  if (args.appApiKey.length === 0) {
    throw new Error("the app API key must not be empty");
  }
  return {
    resolve(request) {
      const presented = request.header(PATCHER_AGENT_KEY_HEADER)?.trim();
      if (!presented) return { kind: "none" };
      const claim = parseAgentAccessCredential(presented);
      // Shaped like nothing this install issues. Treated as "no grant" rather
      // than as a refusal, so a caller that set the header to junk still gets
      // the ordinary 401 about the app key instead of a message about grants
      // it never had.
      if (claim === undefined) return { kind: "none" };
      if (
        !verifyAgentAccessKey({
          appApiKey: args.appApiKey,
          grantId: claim.grantId,
          presented,
        })
      ) {
        return {
          kind: "refused",
          reason: `The browser access grant credential you presented is not one this Patcher issued. Grants are derived from this install's app key, so a credential from another install — or from before this one's key was replaced — will never verify. Ask the person at this machine for a new one: \`patcher agent-access grant\`.`,
        };
      }
      const grant = getBrowserAccessGrant(args.db, claim.grantId);
      if (grant === undefined) {
        return {
          kind: "refused",
          reason: `Browser access grant ${claim.grantId} no longer exists on this Patcher. Ask the person at this machine for a new one: \`patcher agent-access grant\`.`,
        };
      }
      if (grant.revokedAt !== null) {
        return {
          kind: "refused",
          reason: `Browser access grant ${claim.grantId} ("${grant.label}") was revoked, so it no longer opens the browser. That was a person's decision rather than a fault — ask them rather than retrying.`,
        };
      }
      // Written here rather than in the browser route, because the question the
      // field answers is "is anything still using this grant", and a request
      // that goes on to be refused is still a use. Throttled in the query.
      touchBrowserAccessGrantUse(args.db, grant.id);
      return {
        kind: "accepted",
        caller: {
          grantId: grant.id,
          label: grant.label,
          level: grant.level,
        },
      };
    },
  };
}
