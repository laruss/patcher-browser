import {
  hostDaemonEgressHostConsentRequestSchema,
  typedRoutes,
  type HostDaemonEgressHostConsentRequest,
  type HostDaemonEgressHostConsentResponse,
  type HostDaemonInternalSchema,
} from "@patcher/host-daemon-contract";
import { getAppSettings } from "@patcher/db";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { requireThreadEnvironment } from "../services/lib/entity-lookup.js";
import {
  capConsentText,
  CONSENT_DETAIL_MAX,
  CONSENT_INTERACTION_TIMEOUT_MS,
  CONSENT_SUBJECT_NAME_MAX,
} from "../services/interactions/consent-text.js";
import { requireAuthenticatedDaemonSession } from "./session-state.js";
import { streamJsonResponse } from "./stream-json-response.js";

/**
 * Asked before a network-confined turn reaches a host nobody has allowed.
 *
 * The other half of the boundary in the daemon's `egress-proxy.ts`. Until this
 * existed, a host that was on neither the provider's own declaration nor the
 * person's list was simply refused, and the only way to allow one was to stop
 * the turn, open Settings and start again. So the refusal is now a question,
 * and the question is put where the work is.
 *
 * Two things about it are unlike the sibling setup-script consent, and both
 * come from what is waiting on the answer:
 *
 * - **The connection will usually be gone before the answer is.** The proxy is
 *   holding an agent's socket, and an agent's HTTP client gives up long before
 *   a person decides — undici stops waiting after ten seconds. The daemon
 *   therefore remembers the answer rather than only using it, which makes the
 *   agent's *next* attempt the one that goes through. That is why declining is
 *   remembered too: without it, an agent that retries would put the same
 *   question back on screen until somebody gave in.
 * - **Nothing is written down here.** The allow lives for the life of the
 *   grant — one environment's turns of one provider — and Settings is where a
 *   permanent answer goes. A yes given for one turn should not silently widen
 *   every other thread's boundary on the machine for good, and the prompt says
 *   as much (`pending-interaction-formatting.ts`).
 *
 * Every outcome that is not an allow is one of two answers rather than one:
 * `declined` when a person said no, and `unanswered` when nobody could be
 * asked — an archived thread, a thread already holding a question, a prompt
 * that timed out. The daemon keeps the first and not the second.
 */
export function registerInternalEgressHostConsentRoute(
  app: Hono,
  deps: AppDeps,
): void {
  const { post } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  post(
    "/session/egress-host-consent",
    hostDaemonEgressHostConsentRequestSchema,
    async (context, payload) => {
      const session = requireAuthenticatedDaemonSession({
        context,
        db: deps.db,
        sessionId: payload.sessionId,
      });

      const { environment } = requireThreadEnvironment(
        deps.db,
        payload.threadId,
      );
      if (environment.hostId !== session.hostId) {
        throw new ApiError(
          403,
          "invalid_request",
          "Thread does not belong to the session host",
        );
      }

      // The person may have added the host in Settings while the turn ran, in
      // which case there is nothing to ask: the daemon's own list is only as
      // fresh as the launch it was built for.
      const allowedHosts = getAppSettings(deps.db).providerEgressAllowedHosts;
      if (matchesAllowedHost(allowedHosts, payload.host)) {
        return context.json({ outcome: "allowed" } as const);
      }

      // The head goes back now and the answer follows in the body, for the
      // reason the sibling route documents: undici gives up on a response
      // whose headers have not arrived in 300 s, and a decision takes as long
      // as a person takes.
      return streamJsonResponse(askWhetherItMayReachIt({ deps, payload }), {
        onRejected: (error): HostDaemonEgressHostConsentResponse => ({
          outcome: "unanswered",
          reason: `asking you failed (${
            error instanceof Error ? error.message : String(error)
          })`,
        }),
      });
    },
  );
}

/** The same match the proxy makes, so the fast path cannot disagree with it. */
function matchesAllowedHost(
  allowedHosts: readonly string[],
  host: string,
): boolean {
  const normalized = host.toLowerCase();
  return allowedHosts.some((allowed) => {
    const pattern = allowed.trim().toLowerCase();
    if (pattern === "") return false;
    return pattern.startsWith("*.")
      ? normalized.endsWith(pattern.slice(1))
      : pattern === normalized;
  });
}

interface AskWhetherItMayReachItArgs {
  deps: AppDeps;
  payload: HostDaemonEgressHostConsentRequest;
}

async function askWhetherItMayReachIt(
  args: AskWhetherItMayReachItArgs,
): Promise<HostDaemonEgressHostConsentResponse> {
  const { deps, payload } = args;
  let result;
  try {
    result = await deps.pendingInteractions.requestConsentInteraction({
      threadId: payload.threadId,
      timeoutMs: CONSENT_INTERACTION_TIMEOUT_MS,
      payload: {
        kind: "consent",
        action: "reach-host",
        // The hostname is the identity and the whole of what is allowed: it is
        // what the proxy decides on, so it is what the person is asked about.
        subjectId: capConsentText(payload.host, CONSENT_SUBJECT_NAME_MAX),
        subjectName: capConsentText(payload.host, CONSENT_SUBJECT_NAME_MAX),
        permissions: [],
        sites: [],
        detail: capConsentText(
          `Asked for by this thread's ${payload.providerId} process, on port ${payload.port}.`,
          CONSENT_DETAIL_MAX,
        ),
      },
    });
  } catch (error) {
    // A thread that cannot show a prompt, or one already holding a question,
    // arrives here. Neither is a decision, so neither is remembered.
    return {
      outcome: "unanswered",
      reason: `the question could not be put to anyone (${
        error instanceof Error ? error.message : String(error)
      })`,
    };
  }

  if (result.outcome === "cancelled") {
    // Read by a person in the agent's own error text, so the two ordinary ways
    // a prompt ends without a decision say so in words.
    return {
      outcome: "unanswered",
      reason:
        result.reason === "timeout"
          ? "the question went unanswered for four minutes"
          : result.reason === "user"
            ? "you dismissed the question without answering it"
            : `the question ended without an answer (${result.reason})`,
    };
  }

  return result.approved
    ? { outcome: "allowed" }
    : { outcome: "declined" };
}
