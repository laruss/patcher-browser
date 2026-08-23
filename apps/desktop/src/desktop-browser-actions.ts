/**
 * The in-page half of browser interaction: actionability, and the few
 * operations that are semantic rather than positional.
 *
 * **Actionability is the point of this module.** Playwright waits before every
 * action until the element is attached, visible, settled, enabled and actually
 * on top at the point it is about to click. Without that, every action is a race
 * against layout and the agent's failures look nondeterministic — a click that
 * lands on the modal backdrop that was still fading out, a fill into an input
 * that React replaced a frame later. The probe below is that check, run in one
 * round trip and polled until it passes or the deadline runs out.
 *
 * Everything here is a **constant** script. Nothing a caller supplies is ever
 * interpolated into these strings; values reach them as CDP `arguments`, which
 * cross as data. Interpolation here would be script injection inside our own
 * privileged snippet, in a page we do not trust.
 *
 * They run in an isolated world (see `Page.createIsolatedWorld` in
 * desktop-browser-view.ts), so a page cannot shadow the globals they read or
 * observe that they ran.
 */

/** Name of the isolated world these run in; visible only in a CDP trace. */
export const PATCHER_BROWSER_AUTOMATION_WORLD_NAME = "patcher-automation";

/**
 * How long to keep waiting for an element to become actionable. Long enough for
 * a transition or a fetch-driven re-render, short enough to stay well inside the
 * browser bridge's own 10s command timeout so the caller gets our typed reason
 * rather than a generic timeout.
 */
export const PATCHER_BROWSER_ACTION_TIMEOUT_MS = 5_000;
/** Gap between probes. Each probe already spans two animation frames. */
export const PATCHER_BROWSER_ACTION_POLL_INTERVAL_MS = 50;

/**
 * Why an element could not be acted on. These are the sentence an agent gets, so
 * each one has to imply a different next move: `covered` means dismiss whatever
 * is on top, `unstable` means wait, `disabled` means fill something else first.
 */
export type BrowserActionBlockedReason =
  | "detached"
  | "not_visible"
  | "unstable"
  | "disabled"
  | "offscreen"
  | "covered";

export type BrowserActionProbe =
  | { ready: true; x: number; y: number }
  | { ready: false; reason: BrowserActionBlockedReason };

const BLOCKED_REASONS = new Set<string>([
  "detached",
  "not_visible",
  "unstable",
  "disabled",
  "offscreen",
  "covered",
]);

/**
 * One actionability check, returning the point to act at.
 *
 * The two `requestAnimationFrame`s are the stability check: an element whose box
 * moved between them is mid-animation, and clicking its old centre would miss.
 * The hit test is the "not covered" check — an overlay that intercepts the point
 * would otherwise swallow the click silently, which is the failure mode hardest
 * to diagnose from the outside.
 */
export const PATCHER_BROWSER_ACTIONABILITY_SCRIPT = `async function () {
  const node = this;
  const element =
    node instanceof Element
      ? node
      : node && node.parentElement instanceof Element
        ? node.parentElement
        : null;
  if (element === null || !element.isConnected) {
    return { ready: false, reason: "detached" };
  }
  const before = element.getBoundingClientRect();
  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
  if (!element.isConnected) {
    return { ready: false, reason: "detached" };
  }
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { ready: false, reason: "not_visible" };
  }
  if (
    typeof element.checkVisibility === "function" &&
    !element.checkVisibility({ checkVisibilityCSS: true })
  ) {
    return { ready: false, reason: "not_visible" };
  }
  if (
    Math.abs(rect.x - before.x) > 1 ||
    Math.abs(rect.y - before.y) > 1 ||
    Math.abs(rect.width - before.width) > 1 ||
    Math.abs(rect.height - before.height) > 1
  ) {
    return { ready: false, reason: "unstable" };
  }
  if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") {
    return { ready: false, reason: "disabled" };
  }
  const viewWidth = document.documentElement.clientWidth;
  const viewHeight = document.documentElement.clientHeight;
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, viewWidth);
  const bottom = Math.min(rect.bottom, viewHeight);
  if (right <= left || bottom <= top) {
    return { ready: false, reason: "offscreen" };
  }
  const x = (left + right) / 2;
  const y = (top + bottom) / 2;
  const root = element.getRootNode();
  const hit =
    typeof root.elementFromPoint === "function"
      ? root.elementFromPoint(x, y)
      : document.elementFromPoint(x, y);
  if (hit === null) {
    return { ready: false, reason: "covered" };
  }
  // An ancestor hit counts: a label, or an element whose child carries
  // pointer-events, both legitimately answer for the element underneath.
  if (hit !== element && !element.contains(hit) && !hit.contains(element)) {
    return { ready: false, reason: "covered" };
  }
  return { ready: true, x, y };
}`;

/**
 * Focus an editable element and select everything in it, so the text that
 * follows replaces the old value rather than appending to it.
 */
export const PATCHER_BROWSER_PREPARE_FILL_SCRIPT = `function () {
  const element = this instanceof Element ? this : null;
  if (element === null) {
    return { ok: false, reason: "not_editable" };
  }
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    if (element.readOnly || element.disabled) {
      return { ok: false, reason: "not_editable" };
    }
    element.focus();
    element.select();
    return { ok: true };
  }
  if (element.isContentEditable) {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    if (selection !== null) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return { ok: true };
  }
  return { ok: false, reason: "not_editable" };
}`;

/**
 * Choose options in a `<select>`.
 *
 * Semantic on purpose: a native select opens an OS-drawn popup that no
 * synthetic mouse event can reach, so "click the coordinates and hope" is not
 * merely fragile here, it cannot work at all.
 *
 * Values match against the option's value, its label, or its text, because a
 * snapshot shows an agent the text and nothing else.
 */
export const PATCHER_BROWSER_SELECT_OPTION_SCRIPT = `function (values) {
  const element = this instanceof HTMLSelectElement ? this : null;
  if (element === null) {
    return { ok: false, reason: "not_select" };
  }
  const wanted = Array.isArray(values) ? values : [];
  let matched = 0;
  for (const option of Array.from(element.options)) {
    const text = (option.textContent || "").trim();
    const selected = wanted.some(
      (value) => value === option.value || value === option.label || value === text,
    );
    option.selected = selected;
    if (selected) {
      matched += 1;
    }
  }
  if (matched === 0) {
    return { ok: false, reason: "no_matching_option" };
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
}`;

/**
 * Read a control's checked state. Reading it is what makes check/uncheck
 * idempotent — the action is "make it checked", not "toggle it", so it has to
 * know where it is starting from and confirm where it landed.
 */
export const PATCHER_BROWSER_READ_CHECKED_SCRIPT = `function () {
  const element = this instanceof Element ? this : null;
  if (element === null) {
    return { ok: false, reason: "not_checkable" };
  }
  if (
    element instanceof HTMLInputElement &&
    (element.type === "checkbox" || element.type === "radio")
  ) {
    return { ok: true, checked: element.checked };
  }
  const aria = element.getAttribute("aria-checked");
  if (aria === "true" || aria === "false") {
    return { ok: true, checked: aria === "true" };
  }
  return { ok: false, reason: "not_checkable" };
}`;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Validate what the page answered the probe with.
 *
 * Null means the page returned something unusable, which is a different
 * condition from "not ready yet" and must not be retried as one.
 */
export function parseBrowserActionProbe(
  value: unknown,
): BrowserActionProbe | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  if (record.ready === true) {
    const { x, y } = record;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return null;
    }
    return { ready: true, x, y };
  }
  if (record.ready !== false) {
    return null;
  }
  const reason = record.reason;
  if (typeof reason !== "string" || !BLOCKED_REASONS.has(reason)) {
    return null;
  }
  return { ready: false, reason: reason as BrowserActionBlockedReason };
}

export type BrowserScriptOutcome =
  | { ok: true; checked: boolean | null }
  | { ok: false; reason: string };

/**
 * Validate what one of the semantic scripts answered with. `checked` is carried
 * because the checked-state script is the only one that reports a value, and a
 * second result shape for one field would not earn itself.
 */
export function parseBrowserScriptOutcome(
  value: unknown,
): BrowserScriptOutcome | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  if (record.ok === true) {
    return {
      ok: true,
      checked: typeof record.checked === "boolean" ? record.checked : null,
    };
  }
  if (record.ok !== false) {
    return null;
  }
  return {
    ok: false,
    reason: typeof record.reason === "string" ? record.reason : "failed",
  };
}
