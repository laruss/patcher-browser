import type { BrowserCommandIssuer } from "@patcher/server-contract";
import { browserIssuerKey } from "./issuer";
import { BrowserTraceRecorder } from "./trace";

/**
 * One trace per caller, not one per window.
 *
 * `tracing-start` … `tracing-stop` is a caller asking for a record of what *it*
 * did. With a single recorder in the window that is not what it got: a second
 * agent's `tracing-start` was refused `already_recording` for a trace it could
 * not see, its commands were written into the first agent's log, and whichever
 * of them called `tracing-stop` first walked away with the other's trace —
 * screenshots included. Two agents are supported now
 * (`docs/architecture/browser-tab-ownership.md`), so the record has to be too.
 *
 * Keyed the way everything else about a caller is: the kind and its id, never
 * the label. Commands with no issuer — the app's own work, and a plugin running
 * in its own process — share one recorder, which is the same "they are one
 * caller" this install already says about them everywhere else.
 *
 * Recorders are kept for the life of the window rather than dropped when a
 * trace stops, because the object *is* the caller's slot: dropping it would
 * lose a trace that is still running whenever two callers' keys collided, and
 * a window sees a handful of callers, not thousands.
 */

const ANONYMOUS = "";

export interface BrowserTraceRegistry {
  /** The recorder this caller's commands are written to. */
  for(issuer: BrowserCommandIssuer | undefined): BrowserTraceRecorder;
  /** The window is going away; every trace it held goes with it. */
  dispose(): void;
}

export function createBrowserTraceRegistry(): BrowserTraceRegistry {
  const recorders = new Map<string, BrowserTraceRecorder>();
  return {
    for(issuer) {
      const key = issuer === undefined ? ANONYMOUS : browserIssuerKey(issuer);
      const existing = recorders.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const created = new BrowserTraceRecorder();
      recorders.set(key, created);
      return created;
    },
    dispose() {
      recorders.clear();
    },
  };
}
