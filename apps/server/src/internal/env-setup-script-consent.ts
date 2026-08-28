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
import {
  capConsentText,
  CONSENT_DETAIL_MAX,
  CONSENT_INTERACTION_TIMEOUT_MS,
  CONSENT_SUBJECT_NAME_MAX,
} from "../services/interactions/consent-text.js";
import { requireAuthenticatedDaemonSession } from "./session-state.js";

/**
 * Room the detail line keeps for what it is actually about.
 *
 * The path is the only unbounded part of that line, so it is the part that gets
 * capped — capping the composed line instead would truncate away the size and
 * the hash, which are the two things the line exists to show.
 */
const DETAIL_PATH_MAX = 400;

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
          timeoutMs: CONSENT_INTERACTION_TIMEOUT_MS,
          signal: context.req.raw.signal,
          payload: {
            kind: "consent",
            action: "run-setup-script",
            // The hash is the identity: it is what the allow is remembered
            // against, so it is what the user is being asked about.
            subjectId: payload.scriptSha256,
            subjectName: capConsentText(
              basename(payload.scriptPath),
              CONSENT_SUBJECT_NAME_MAX,
            ),
            permissions: [],
            sites: [],
            detail: capConsentText(
              `${capConsentText(payload.scriptPath, DETAIL_PATH_MAX)} — ${payload.scriptByteLength} bytes, sha256 ${payload.scriptSha256.slice(0, 12)}…`,
              CONSENT_DETAIL_MAX,
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
        // This reason is read by a person, in the provisioning transcript, so
        // the two ways a prompt ordinarily ends without a decision say so in
        // words. The rest are internal lifecycle names and are named as such.
        return context.json({
          outcome: "refused",
          reason:
            result.reason === "timeout"
              ? "the question went unanswered for four minutes"
              : result.reason === "user"
                ? "you dismissed the question without answering it"
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
