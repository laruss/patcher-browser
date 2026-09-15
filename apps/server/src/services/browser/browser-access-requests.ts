import { randomBytes } from "node:crypto";
import type { BrowserAccessGrantRow } from "@patcher/db";
import {
  BROWSER_ACCESS_GRANT_LEVELS,
  type BrowserAccessGrantLevel,
} from "@patcher/domain";
import type { SystemBrowserAccessRequest } from "@patcher/server-contract";
import { ApiError } from "../../errors.js";

/**
 * An agent outside Patcher asking the person for a browser access grant, in the
 * window, instead of being refused and sending them to a terminal (#135).
 *
 * **It adds no reach.** The caller is a CLI holding the app key, which can mint
 * a grant with no prompt at all (`routes/system.ts`). What changes is that the
 * supported path puts the decision in front of the person, attributed, before a
 * credential exists — rather than a command copied from an agent's reply into
 * their terminal, and the key back through the agent's transcript.
 *
 * **Held in memory, not in a table.** A request lives for minutes, the handover
 * ask one layer over sets the precedent (`tab-owners.ts`, "Not persisted"), and
 * a restart that drops one costs the agent asking again. The grant it ends in is
 * the ordinary row, so pause, revoke and the driving indicator apply unchanged.
 *
 * **Minted when the person presses Allow, not when the key is collected.** A
 * grant minted at collection would be invisible in Settings between the click
 * and the pickup, could not be taken back there, and would turn the plugin on
 * at the poller's moment rather than the person's. So Allow mints, collecting
 * only derives the key, and an approval nobody collects before the request
 * expires is revoked — a grant nobody holds is the state `patcher agent-access
 * grant` revokes to avoid (#134). A restart in that window leaves a named grant
 * that was never used, visible and revocable.
 *
 * **No pickup token.** Everything that can reach the outcome route holds the
 * app key and could mint a grant of its own under any label, so a token would
 * protect nothing, and it would make a wait cut short by the agent's tool
 * timeout unrecoverable. Asking again under the same label and level resumes the
 * open request instead.
 */

/** How long a request waits for an answer, and how long an approval waits to be collected. */
export const BROWSER_ACCESS_REQUEST_TTL_MS = 10 * 60 * 1000;

/**
 * How long a label that was told no is refused.
 *
 * Keyed by the label, which the asker chooses, so a program that renames itself
 * is not stopped by it. What it stops is the loop that needs no intent — an
 * agent re-running the command it was told to run — which is the prompt fatigue
 * worth preventing.
 */
export const BROWSER_ACCESS_REQUEST_DENIAL_COOLDOWN_MS = 10 * 60 * 1000;

/** Open requests at once, across every label: more is noise, not questions. */
export const MAX_OPEN_BROWSER_ACCESS_REQUESTS = 5;

type RequestState =
  | { kind: "pending" }
  // Allow was pressed and the grant is being minted; the row stays up meanwhile.
  | { kind: "deciding" }
  | { kind: "approved"; grantId: string }
  | { kind: "denied" };

interface Entry {
  request: SystemBrowserAccessRequest;
  state: RequestState;
  timer: ReturnType<typeof setTimeout>;
}

export interface BrowserAccessRequestsDeps {
  /** Mint the ordinary grant, turning `browser-tools` on when it is not serving. */
  issueGrant(args: {
    label: string;
    level: BrowserAccessGrantLevel;
  }): Promise<BrowserAccessGrantRow>;
  getGrant(id: string): BrowserAccessGrantRow | undefined;
  revokeGrant(id: string): void;
  /** Tell every window the pending list or the grants changed. */
  changed(): void;
}

export interface BrowserAccessRequestCreateArgs {
  label: string;
  level: BrowserAccessGrantLevel;
  reason?: string;
}

export interface BrowserAccessRequestDecideArgs {
  decision: "allow" | "deny";
  level?: BrowserAccessGrantLevel;
}

export type BrowserAccessRequestCollection =
  | { outcome: "pending"; request: SystemBrowserAccessRequest }
  | { outcome: "denied" }
  | { outcome: "approved"; grant: BrowserAccessGrantRow };

export type BrowserAccessRequests = ReturnType<
  typeof createBrowserAccessRequests
>;

function levelRank(level: BrowserAccessGrantLevel): number {
  return BROWSER_ACCESS_GRANT_LEVELS.indexOf(level);
}

export function createBrowserAccessRequests(deps: BrowserAccessRequestsDeps) {
  // Insertion order is creation order, which is the order the window answers in.
  const entries = new Map<string, Entry>();
  const deniedAt = new Map<string, number>();

  function end(entry: Entry): void {
    clearTimeout(entry.timer);
    entries.delete(entry.request.id);
  }

  function expire(entry: Entry): void {
    if (entries.get(entry.request.id) !== entry) return;
    end(entry);
    if (entry.state.kind === "approved") deps.revokeGrant(entry.state.grantId);
    deps.changed();
  }

  /** The timers do this on time; this covers a timer that ran late. */
  function sweep(now: number): void {
    for (const entry of [...entries.values()]) {
      if (entry.request.expiresAt <= now) expire(entry);
    }
    for (const [label, at] of deniedAt) {
      if (now - at >= BROWSER_ACCESS_REQUEST_DENIAL_COOLDOWN_MS) {
        deniedAt.delete(label);
      }
    }
  }

  function waiting(): SystemBrowserAccessRequest[] {
    return [...entries.values()]
      .filter(
        (entry) =>
          entry.state.kind === "pending" || entry.state.kind === "deciding",
      )
      .map((entry) => entry.request);
  }

  function missing(id: string): ApiError {
    return new ApiError(
      404,
      "not_found",
      `No browser access request '${id}' is open. It was answered and collected, went unanswered for ${BROWSER_ACCESS_REQUEST_TTL_MS / 60_000} minutes, or the server restarted since. Nothing was granted by this.`,
    );
  }

  return {
    list(): SystemBrowserAccessRequest[] {
      sweep(Date.now());
      return waiting();
    },

    create(args: BrowserAccessRequestCreateArgs): SystemBrowserAccessRequest {
      const now = Date.now();
      sweep(now);
      // Before the open request, so a caller re-running the command it was
      // cut off in hears the answer rather than "still waiting".
      if (deniedAt.has(args.label)) {
        throw new ApiError(
          409,
          "conflict",
          `The person at this machine answered no to "${args.label}" within the last ${BROWSER_ACCESS_REQUEST_DENIAL_COOLDOWN_MS / 60_000} minutes. Nothing was asked. Do not ask again, and do not issue yourself a grant or change the setting instead: that answer was theirs to give. If you think they misread, say so to them in words.`,
        );
      }
      const open = [...entries.values()].find(
        (entry) => entry.request.label === args.label,
      );
      if (open !== undefined) {
        if (open.request.level === args.level) return open.request;
        throw new ApiError(
          409,
          "conflict",
          `A request from "${args.label}" for "${open.request.level}" is already waiting on the person. Nothing new was asked; wait for that answer by asking again at "${open.request.level}", or use another label for a different program.`,
        );
      }
      // What is in front of the person, not every entry: an answer waiting to
      // be collected is no longer a question, and counting it would refuse a
      // new asker while the window shows nothing.
      if (waiting().length >= MAX_OPEN_BROWSER_ACCESS_REQUESTS) {
        throw new ApiError(
          429,
          "too_many_requests",
          `${MAX_OPEN_BROWSER_ACCESS_REQUESTS} browser access requests are already waiting on the person at this machine. Nothing was asked; wait for those to be answered or to expire.`,
        );
      }
      const reason =
        args.reason === undefined || args.reason.length === 0
          ? null
          : args.reason;
      const request: SystemBrowserAccessRequest = {
        id: `bar_${randomBytes(8).toString("hex")}`,
        label: args.label,
        level: args.level,
        reason,
        createdAt: now,
        expiresAt: now + BROWSER_ACCESS_REQUEST_TTL_MS,
      };
      const entry: Entry = {
        request,
        state: { kind: "pending" },
        timer: setTimeout(() => expire(entry), BROWSER_ACCESS_REQUEST_TTL_MS),
      };
      entry.timer.unref();
      entries.set(request.id, entry);
      deps.changed();
      return request;
    },

    /**
     * Where a request stands, for the program that asked. An answer ends the
     * request, so an approval's grant is handed over once.
     */
    collect(id: string): BrowserAccessRequestCollection {
      sweep(Date.now());
      const entry = entries.get(id);
      if (entry === undefined) throw missing(id);
      const { state } = entry;
      if (state.kind === "pending" || state.kind === "deciding") {
        return { outcome: "pending", request: entry.request };
      }
      // Already out of the window's list, so nothing to tell it.
      end(entry);
      if (state.kind === "denied") return { outcome: "denied" };
      const grant = deps.getGrant(state.grantId);
      if (grant === undefined || grant.revokedAt !== null) {
        throw new ApiError(
          409,
          "conflict",
          `The person allowed "${entry.request.label}" and then revoked the grant before it was collected. Nothing was handed over. Ask them before asking again.`,
        );
      }
      return { outcome: "approved", grant };
    },

    async decide(
      id: string,
      args: BrowserAccessRequestDecideArgs,
    ): Promise<SystemBrowserAccessRequest[]> {
      const now = Date.now();
      sweep(now);
      const entry = entries.get(id);
      if (entry === undefined) throw missing(id);
      if (entry.state.kind !== "pending") {
        throw new ApiError(
          409,
          "conflict",
          `Browser access request '${id}' was already answered. Nothing changed.`,
        );
      }
      if (args.decision === "deny") {
        entry.state = { kind: "denied" };
        deniedAt.set(entry.request.label, now);
        deps.changed();
        return waiting();
      }
      const level = args.level ?? entry.request.level;
      if (levelRank(level) > levelRank(entry.request.level)) {
        throw new ApiError(
          400,
          "invalid_request",
          `"${entry.request.label}" asked for "${entry.request.level}", and allowing "${level}" would grant more than was asked. Nothing changed.`,
        );
      }
      entry.state = { kind: "deciding" };
      let grant: BrowserAccessGrantRow;
      try {
        grant = await deps.issueGrant({ label: entry.request.label, level });
      } catch (error) {
        if (entries.get(id) === entry) entry.state = { kind: "pending" };
        throw error;
      }
      // It expired while the plugin was being turned on: nobody can collect
      // this grant any more.
      if (entries.get(id) !== entry) {
        deps.revokeGrant(grant.id);
        throw missing(id);
      }
      entry.state = { kind: "approved", grantId: grant.id };
      deps.changed();
      return waiting();
    },
  };
}
