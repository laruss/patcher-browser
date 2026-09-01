import { basename } from "node:path";
import {
  hostDaemonEnvSetupScriptConsentRequestSchema,
  typedRoutes,
  type HostDaemonEnvSetupScriptConsentRequest,
  type HostDaemonEnvSetupScriptConsentResponse,
  type HostDaemonInternalSchema,
} from "@patcher/host-daemon-contract";
import {
  forgetEnvSetupScriptQuestion,
  getProjectSourceByHost,
  hasEnvSetupScriptAllowance,
  recordEnvSetupScriptAllowance,
  recordEnvSetupScriptQuestion,
  type EnvSetupScriptSighting,
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
import { streamJsonResponse } from "./stream-json-response.js";

/**
 * Room the detail line keeps for what it is actually about.
 *
 * The path is the only unbounded part of that line, so it is the part that gets
 * capped — capping the composed line instead would truncate away the size and
 * the hash, which are the two things the line exists to show.
 */
const DETAIL_PATH_MAX = 400;

/**
 * Where an unanswered question can still be answered.
 *
 * Said in the reason itself, because the reason is read in the provisioning
 * transcript by whoever finds the script did not run — and for a schedule or a
 * delegated thread that is the only place the question surfaces at all.
 */
const WHERE_TO_ANSWER =
  ". The question is kept in the project's settings, where allowing it lets the next provision run it without asking";

/**
 * Asked before this machine runs a repository's own `.patcher-env-setup.sh`.
 *
 * The daemon runs that script on the host, outside every sandbox, as the user,
 * and it is a tracked file in a repository an agent can write to. So the
 * question is put once per repository per script content, and the answer is
 * remembered against all four things it was an answer about: this project, this
 * machine, the repository at that path on it, and those exact bytes. Narrower
 * than it looks: a script's effect is not in its bytes — `npm ci` runs whatever
 * the repository around it says — so a yes given for one checkout must not
 * travel to another that happens to hold the same three characters.
 *
 * Every outcome that is not an allow answers `refused`, including the ones where
 * nobody could have been asked — an unanswered prompt, a thread already holding
 * a question, a thread that cannot show one. The daemon turns that into a
 * skipped script and a line in the provisioning transcript, rather than a failed
 * provision: the worktree is what the user asked for, and only the script is in
 * question.
 *
 * Those are also the outcomes a schedule and a delegated thread always get,
 * because they provision in a thread nobody is watching. So the question is kept
 * rather than dropped, and the project's settings are where it can be answered
 * afterwards — otherwise every run of that schedule spends the same four minutes
 * asking nobody.
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

      // The repository the worktree came from, which is what a yes is about —
      // not the worktree, which is a new path every time. A project with no
      // source on this machine has the environment's own path instead: an
      // unmanaged workspace *is* the checkout it ran in.
      const sourcePath =
        getProjectSourceByHost(
          deps.db,
          environment.projectId,
          environment.hostId,
        )?.path ?? environment.path;
      if (sourcePath === null) {
        return context.json({
          outcome: "refused",
          reason:
            "this environment has no path on the machine, so there is no repository to remember an answer against",
        } as const);
      }

      const sighting: EnvSetupScriptSighting = {
        projectId: environment.projectId,
        hostId: environment.hostId,
        sourcePath,
        scriptSha256: payload.scriptSha256,
        scriptPath: payload.scriptPath,
        scriptByteLength: payload.scriptByteLength,
      };
      if (hasEnvSetupScriptAllowance(deps.db, sighting)) {
        return context.json({ outcome: "approved" } as const);
      }

      // The head goes back now and the answer follows in the body. Holding the
      // head for the length of a human decision is what the sibling tool-call
      // route exists not to do: a hop that wants an origin response head within
      // thirty seconds would tear this down mid-decision, and the failure would
      // present as "the script is never set up" rather than as an error.
      return streamJsonResponse(
        askWhetherItMayRun({
          deps,
          payload,
          sighting,
          signal: context.req.raw.signal,
        }),
        {
          onRejected: (error): HostDaemonEnvSetupScriptConsentResponse => ({
            outcome: "refused",
            reason: `asking you failed (${
              error instanceof Error ? error.message : String(error)
            })`,
          }),
        },
      );
    },
  );
}

interface AskWhetherItMayRunArgs {
  deps: AppDeps;
  payload: HostDaemonEnvSetupScriptConsentRequest;
  sighting: EnvSetupScriptSighting;
  signal: AbortSignal;
}

async function askWhetherItMayRun(
  args: AskWhetherItMayRunArgs,
): Promise<HostDaemonEnvSetupScriptConsentResponse> {
  const { deps, payload, sighting } = args;
  // Every way this ends without an allow of its own re-reads the remembered
  // answer first. Provisions of one repository run concurrently — a fanout puts
  // the same question on several threads at once, and each of them missed the
  // fast path before any of them was answered — so allowing one of them is
  // allowing this script, and the siblings should not each demand their own
  // click and then time out.
  //
  // Then the question is kept: this is the path a thread nobody is watching
  // always takes, and it is kept for the scope it was asked about, so answering
  // it later is the same answer as answering the prompt would have been.
  const refuse = (reason: string): HostDaemonEnvSetupScriptConsentResponse => {
    if (hasEnvSetupScriptAllowance(deps.db, sighting)) {
      return { outcome: "approved" };
    }
    try {
      recordEnvSetupScriptQuestion(deps.db, deps.hub, sighting);
    } catch (error) {
      // Failing to keep the question is a reason to say less, not to answer
      // something other than what happened.
      deps.logger.warn(
        { err: error, projectId: sighting.projectId },
        "Failed to keep an unanswered setup-script question",
      );
      return { outcome: "refused", reason };
    }
    return { outcome: "refused", reason: `${reason}${WHERE_TO_ANSWER}` };
  };

  let result;
  try {
    result = await deps.pendingInteractions.requestConsentInteraction({
      threadId: payload.threadId,
      timeoutMs: CONSENT_INTERACTION_TIMEOUT_MS,
      signal: args.signal,
      payload: {
        kind: "consent",
        action: "run-setup-script",
        // The hash is the identity: it is what the allow is remembered
        // against, so it is what the user is being asked about.
        subjectId: payload.scriptSha256,
        // `basename` answers "" for a path that is nothing but separators, and
        // the payload schema requires a name, so the row would be written and
        // then fail to parse — stranding the thread's one interaction slot.
        subjectName: capConsentText(
          basename(payload.scriptPath) || payload.scriptPath,
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
    return refuse(
      `the question could not be put to anyone (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }

  if (result.outcome === "cancelled") {
    // This reason is read by a person, in the provisioning transcript, so the
    // two ways a prompt ordinarily ends without a decision say so in words.
    // The rest are internal lifecycle names and are named as such.
    return refuse(
      result.reason === "timeout"
        ? "the question went unanswered for four minutes"
        : result.reason === "user"
          ? "you dismissed the question without answering it"
          : `the question ended without an answer (${result.reason})`,
    );
  }

  if (!result.approved) {
    // A decline is the one outcome that is not "nobody answered", so it stands
    // on its own rather than deferring to a sibling's allow — and it answers any
    // question an earlier unwatched run left standing, which would otherwise go
    // on presenting this script as waiting for a decision that was just made.
    try {
      forgetEnvSetupScriptQuestion(deps.db, deps.hub, sighting);
    } catch (error) {
      deps.logger.warn(
        { err: error, projectId: sighting.projectId },
        "Failed to drop a setup-script question a decline answered",
      );
    }
    return { outcome: "refused", reason: "you did not allow it" };
  }

  try {
    recordEnvSetupScriptAllowance(deps.db, deps.hub, sighting);
  } catch (error) {
    // They allowed it. Failing to remember that is a reason to ask again next
    // time, not a reason to report their answer back as a refusal.
    deps.logger.warn(
      { err: error, projectId: sighting.projectId },
      "Failed to remember a setup-script approval",
    );
  }
  return { outcome: "approved" };
}
