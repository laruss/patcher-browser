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
 * A recorder is kept while its trace runs and dropped once it is idle, so the
 * registry holds one entry per caller *currently recording* rather than one per
 * caller the window has ever served. A stopped trace has already been handed
 * back — `stop()` clears its steps and its image budget — so the object left
 * behind is a slot, not a log, and keeping every one of them would mean a
 * window that has served a hundred threads holds a hundred slots for nothing.
 *
 * What is not bounded, and is worth saying: a caller that starts a trace and
 * never stops it holds its own image budget until the window closes, so the
 * memory a window can hold is that budget times the number of callers recording
 * at once. That is what "a trace per caller" costs; the alternative — one
 * budget shared by everyone — is the shared recorder this replaced.
 */

const ANONYMOUS = "";

export interface BrowserTraceRegistry {
  /** The recorder this caller's commands are written to. */
  for(issuer: BrowserCommandIssuer | undefined): BrowserTraceRecorder;
  /** The window is going away; every trace it held goes with it. */
  dispose(): void;
  /**
   * How many recorders are held. Here for the same reason the queue's is: the
   * sweep that keeps this from growing is invisible to every other assertion.
   */
  readonly size: number;
}

export function createBrowserTraceRegistry(): BrowserTraceRegistry {
  const recorders = new Map<string, BrowserTraceRecorder>();
  return {
    for(issuer) {
      const key = issuer === undefined ? ANONYMOUS : browserIssuerKey(issuer);
      // Every command comes through here, which makes this the sweep: a
      // recorder whose trace is not running holds nothing anybody can still
      // read, and its caller may never be seen again.
      for (const [held, recorder] of recorders) {
        if (held !== key && !recorder.active) {
          recorders.delete(held);
        }
      }
      const existing = recorders.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const created = new BrowserTraceRecorder();
      recorders.set(key, created);
      return created;
    },
    get size() {
      return recorders.size;
    },
    dispose() {
      recorders.clear();
    },
  };
}
