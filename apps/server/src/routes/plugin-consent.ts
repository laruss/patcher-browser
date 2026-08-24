import type { Context } from "hono";
import { PATCHER_THREAD_ID_HEADER } from "@patcher/server-contract";
import type { PendingInteractionConsentAction } from "@patcher/domain";
import type { AppDeps } from "../types.js";

/**
 * How long a consent prompt waits before it gives up.
 *
 * Four minutes rather than the ten a plugin question gets: this one blocks a
 * command an agent is sitting on, and a turn parked on a prompt nobody is
 * looking at is worse than a turn told to ask again.
 *
 * Four rather than five because the answer travels back as the response to a
 * request the CLI is still holding open, and undici — Node's `fetch` — gives up
 * on a response whose headers have not arrived in 300 s. At five, the client
 * always loses the race: the agent gets `UND_ERR_HEADERS_TIMEOUT` instead of the
 * sentence below, and the socket closing aborts the prompt off the user's screen
 * at the exact moment they may be deciding.
 */
const PLUGIN_CONSENT_TIMEOUT_MS = 4 * 60 * 1000;

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
  if (value.length <= max) return value;
  // Never cut a surrogate pair in half. A lone surrogate renders as a
  // replacement glyph, and this string is the identity the user is being asked
  // to trust — corrupting it at the one boundary a caller controls is exactly
  // what should not happen here.
  const lastKept = value.charCodeAt(max - 2);
  const end = lastKept >= 0xd800 && lastKept <= 0xdbff ? max - 2 : max - 1;
  return `${value.slice(0, end)}…`;
}

function capConsentList(values: readonly string[], itemMax: number): string[] {
  return values
    .slice(0, LIST_MAX)
    .map((value) => capConsentText(value, itemMax));
}

/**
 * Whether this request declares the thread it was made from, i.e. whether
 * `requirePluginConsent` will ask anyone anything.
 *
 * Exported so a route can skip the work of describing the change — reading a
 * manifest, building a plugin list — on the path that asks nothing.
 */
export function declaresThread(context: {
  // Structural rather than Hono's `Context`, so a typed route's narrower
  // context satisfies it too.
  req: { header: (name: string) => string | undefined };
}): boolean {
  return (context.req.header(PATCHER_THREAD_ID_HEADER)?.trim() ?? "") !== "";
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

  // Deliberately not naming a screen: plugin management lives under Settings →
  // Plugins, and only moves to Extensions → Plugins while the toolsHub
  // experiment is on, which it is not by default.
  const manual = "The user can do it themselves in Patcher's plugin settings.";
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
          ? `The request to allow this went unanswered for four minutes, so nothing changed. Ask in your reply instead of retrying. ${manual}`
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
