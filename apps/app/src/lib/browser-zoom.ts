import {
  PATCHER_DESKTOP_BROWSER_MAX_ZOOM_FACTOR,
  PATCHER_DESKTOP_BROWSER_MIN_ZOOM_FACTOR,
} from "@patcher/desktop-contract";

/**
 * Page zoom steps, and how to walk them.
 *
 * The table is Chrome's, not a formula: users recognise 110% and 125% as the
 * two notches above 100%, and a fixed ratio would land on neither. Kept free of
 * React and of the desktop bridge so the walk is directly testable.
 */
export const BROWSER_ZOOM_FACTORS: readonly number[] = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
  5,
];

export const BROWSER_ZOOM_DEFAULT_FACTOR = 1;

/**
 * How close to a notch still counts as being on it.
 *
 * The factor walked from is the one Chromium reports, and Chromium keeps zoom as
 * a *level* on a log scale — so what comes back for a notch this table set is
 * only as exact as `1.2 ** level` happens to be. A factor that lands a step
 * *below* its own notch starts the walk one notch lower, and zooming in from
 * there returns the factor the page is already at: a chord that does nothing.
 *
 * `Number.EPSILON` does not cover it, because it is the gap next to 1 while the
 * gap between doubles grows with the number — from 2 up, one step of the factor's
 * own precision is already wider than `EPSILON`, so a factor a single step below
 * the 200% notch reads as being under it. This is still four orders of magnitude
 * tighter than the smallest gap between two notches (0.05), so it cannot merge
 * two of them.
 */
const ZOOM_FACTOR_TOLERANCE = 1e-6;

/**
 * Nearest step at or below `factor`, which is where a walk starts.
 *
 * "At or below" rather than "nearest" because a page can arrive at a factor
 * that is not on the table at all — Chromium restores what a site was left at,
 * and that could have come from a pinch or another browser's table. Stepping up
 * from below never skips the notch the user can see.
 */

function stepIndexFor(factor: number): number {
  let index = 0;
  for (const [candidate, value] of BROWSER_ZOOM_FACTORS.entries()) {
    if (value <= factor + ZOOM_FACTOR_TOLERANCE) {
      index = candidate;
    }
  }
  return index;
}

export function clampBrowserZoomFactor(factor: number): number {
  if (!Number.isFinite(factor)) {
    return BROWSER_ZOOM_DEFAULT_FACTOR;
  }
  return Math.min(
    Math.max(factor, PATCHER_DESKTOP_BROWSER_MIN_ZOOM_FACTOR),
    PATCHER_DESKTOP_BROWSER_MAX_ZOOM_FACTOR,
  );
}

/** The next step in `direction`, or the same factor at either end. */
export function stepBrowserZoomFactor(
  factor: number,
  direction: "in" | "out",
): number {
  const clamped = clampBrowserZoomFactor(factor);
  const index = stepIndexFor(clamped);
  if (direction === "out") {
    // A factor between two notches steps *down* to the one below it, which is
    // already where the index points — moving again would skip a notch.
    const below = BROWSER_ZOOM_FACTORS[index];
    if (below !== undefined && below < clamped - ZOOM_FACTOR_TOLERANCE) {
      return below;
    }
    return BROWSER_ZOOM_FACTORS[Math.max(0, index - 1)] ?? clamped;
  }
  return (
    BROWSER_ZOOM_FACTORS[
      Math.min(BROWSER_ZOOM_FACTORS.length - 1, index + 1)
    ] ?? clamped
  );
}
