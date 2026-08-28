import { basename } from "node:path";
import {
  hostDaemonEnvSetupScriptConsentRequestSchema,
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@patcher/host-daemon-contract";
import {
  hasEnvSetupScriptApproval,
  recordEnvSetupScriptApproval,
} from "@patcher/db";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { requireThreadEnvironment } from "../services/lib/entity-lookup.js";
import { requireAuthenticatedDaemonSession } from "./session-state.js";

/**
 * How long the daemon's request waits before the answer stops being possible.
 *
 * Four minutes, the same figure the plugin consent uses and for the same
 * reason: the answer travels back as the response to a request the daemon is
 * still holding open, and undici — Node's `fetch` — gives up on a response
 * whose headers have not arrived in 300 s. At five the daemon always loses the
 * race, and losing it aborts the prompt off the screen at the moment somebody
 * may be deciding.
 */
const ENV_SETUP_SCRIPT_CONSENT_TIMEOUT_MS = 4 * 60 * 1000;

const DETAIL_MAX = 500;
const SUBJECT_NAME_MAX = 200;

function cap(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Asked before this machine runs a repository's own `.patcher-env-setup.sh`.
 *
 * The daemon runs that script on the host, outside every sandbox, as the user,
 * and it is a tracked file in a repository an agent can write to. So the
 * question is put once per repository per script content: an allow is
 * remembered against the project and the content hash, and a script that
 * changed is a script nobody has seen yet.
 *
 * Every outcome that is not an allow answers `refused`, including the ones
 * where nobody could have been asked — an unanswered prompt, a thread already
 * holding a question, a thread that cannot show one. The daemon turns that into
 * a skipped script and a line in the provisioning transcript, rather than a
 * failed provision: the worktree is what the user asked for, and only the
 * script is in question.
 */
export function registerInternalEnvSetupScriptConsentRoute(
  app: Hono,
  deps: AppDeps,
): void {
  const { post } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  post(
    "/session/env-setup-script-consent",
    hostDaemonEnvSetupScriptConsentRequestSchema,
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
      if (environment.id !== payload.environmentId) {
        throw new ApiError(
          403,
          "invalid_request",
          "Thread does not belong to the environment being provisioned",
        );
      }

      const approvalKey = {
        projectId: environment.projectId,
        scriptSha256: payload.scriptSha256,
      };
      if (hasEnvSetupScriptApproval(deps.db, approvalKey)) {
        return context.json({ outcome: "approved" } as const);
      }

      let result;
      try {
        result = await deps.pendingInteractions.requestConsentInteraction({
          threadId: payload.threadId,
          timeoutMs: ENV_SETUP_SCRIPT_CONSENT_TIMEOUT_MS,
          signal: context.req.raw.signal,
          payload: {
            kind: "consent",
            action: "run-setup-script",
            // The hash is the identity: it is what the allow is remembered
            // against, so it is what the user is being asked about.
            subjectId: payload.scriptSha256,
            subjectName: cap(basename(payload.scriptPath), SUBJECT_NAME_MAX),
            permissions: [],
            sites: [],
            detail: cap(
              `${payload.scriptPath} — ${payload.scriptByteLength} bytes, sha256 ${payload.scriptSha256.slice(0, 12)}…`,
              DETAIL_MAX,
            ),
          },
        });
      } catch (error) {
        return context.json({
          outcome: "refused",
          reason: `the question could not be put to anyone (${
            error instanceof Error ? error.message : String(error)
          })`,
        } as const);
      }

      if (result.outcome === "cancelled") {
        return context.json({
          outcome: "refused",
          reason:
            result.reason === "timeout"
              ? "the question went unanswered for four minutes"
              : `the question ended without an answer (${result.reason})`,
        } as const);
      }

      if (!result.approved) {
        return context.json({
          outcome: "refused",
          reason: "you did not allow it",
        } as const);
      }

      recordEnvSetupScriptApproval(deps.db, approvalKey);
      return context.json({ outcome: "approved" } as const);
    },
  );
}
