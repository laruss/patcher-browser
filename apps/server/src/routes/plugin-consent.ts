import type { Context } from "hono";
import { PATCHER_THREAD_ID_HEADER } from "@patcher/server-contract";
import type { PendingInteractionConsentAction } from "@patcher/domain";
import type { AppDeps } from "../types.js";

/**
 * How long a consent prompt waits before it gives up.
 *
 * Five minutes rather than the ten a plugin question gets: this one blocks a
 * command an agent is sitting on, and a turn parked on a prompt nobody is
 * looking at is worse than a turn told to ask again.
 */
const PLUGIN_CONSENT_TIMEOUT_MS = 5 * 60 * 1000;

const SUBJECT_ID_MAX = 200;
const SUBJECT_NAME_MAX = 200;
const PERMISSION_MAX = 100;
const SITE_MAX = 255;
const LIST_MAX = 50;
const DETAIL_MAX = 500;

export interface PluginConsentDeps {
  /**
   * Optional so a test harness can register plugin routes without standing up
   * the interaction service. A request that declares no thread never reaches
   * it; one that does and finds it missing is refused rather than allowed.
   */
  pendingInteractions?: Pick<
    AppDeps["pendingInteractions"],
    "requestConsentInteraction"
  >;
}

export interface RequirePluginConsentArgs {
  action: PendingInteractionConsentAction;
  context: Context;
  deps: PluginConsentDeps;
  detail?: string | null;
  /** Declared permissions the change puts in play; empty when none are known. */
  permissions?: readonly string[];
  /** Declared sites, when the manifest names any. */
  sites?: readonly string[];
  subjectId: string;
  /** A display name; for an install, the source spec is all that exists yet. */
  subjectName?: string;
}

export type PluginConsentOutcome =
  | { allowed: true }
  | { allowed: false; error: string; status: 403 | 409 | 503 };

/**
 * The consent payload's caps are wire limits, and these strings come from a
 * plugin manifest or a caller's install source, neither of which is bounded by
 * anything a route controls. Truncating keeps a long source from failing the
 * schema and reaching the agent as an unexplained refusal.
 */
function capConsentText(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function capConsentList(values: readonly string[], itemMax: number): string[] {
  return values
    .slice(0, LIST_MAX)
    .map((value) => capConsentText(value, itemMax));
}

/**
 * Ask the user before a plugin change an agent asked for.
 *
 * The gate is the declared thread (see PATCHER_THREAD_ID_HEADER): a request
 * without one is a person at their own terminal, or the app's own toggle, and
 * behaves exactly as it did before. A request with one is an agent mid-turn,
 * and enabling a plugin hands that agent whatever the plugin can reach — for
 * browser-tools, the pages its user is signed in to. Patcher has no step where
 * a user grants a plugin its permissions, so this prompt is where the grant
 * happens.
 *
 * Every failure path refuses: a prompt that could not be shown is not consent.
 * The error text is written for the agent that will read it, and says what did
 * not happen and what to do instead, because an agent told only "no" retries
 * the same call.
 */
export async function requirePluginConsent(
  args: RequirePluginConsentArgs,
): Promise<PluginConsentOutcome> {
  const threadId = args.context.req.header(PATCHER_THREAD_ID_HEADER)?.trim();
  if (!threadId) {
    return { allowed: true };
  }

  const manual = "The user can do it themselves under Extensions → Plugins.";
  if (!args.deps.pendingInteractions) {
    return {
      allowed: false,
      status: 503,
      error: `Cannot ask the user to allow this: no interaction service is running. Nothing changed. ${manual}`,
    };
  }

  let result;
  try {
    result = await args.deps.pendingInteractions.requestConsentInteraction({
      threadId,
      timeoutMs: PLUGIN_CONSENT_TIMEOUT_MS,
      signal: args.context.req.raw.signal,
      payload: {
        kind: "consent",
        action: args.action,
        subjectId: capConsentText(args.subjectId, SUBJECT_ID_MAX),
        subjectName: capConsentText(
          args.subjectName ?? args.subjectId,
          SUBJECT_NAME_MAX,
        ),
        permissions: capConsentList(args.permissions ?? [], PERMISSION_MAX),
        sites: capConsentList(args.sites ?? [], SITE_MAX),
        detail:
          args.detail === undefined || args.detail === null
            ? null
            : capConsentText(args.detail, DETAIL_MAX),
      },
    });
  } catch (error) {
    // A bogus thread id, or a thread already holding a question. Both mean the
    // question was never put to anyone.
    return {
      allowed: false,
      status: 409,
      error: `Could not ask the user to allow this (${
        error instanceof Error ? error.message : String(error)
      }). Nothing changed. ${manual}`,
    };
  }

  if (result.outcome === "cancelled") {
    return {
      allowed: false,
      status: 403,
      error:
        result.reason === "timeout"
          ? `The request to allow this went unanswered for five minutes, so nothing changed. Ask in your reply instead of retrying. ${manual}`
          : `The request to allow this ended without an answer (${result.reason}), so nothing changed. ${manual}`,
    };
  }
  if (!result.approved) {
    return {
      allowed: false,
      status: 403,
      error:
        "The user declined. Nothing changed. Do not retry the command: if you think the request was misread, say what it was for in your reply and let them decide.",
    };
  }
  return { allowed: true };
}
