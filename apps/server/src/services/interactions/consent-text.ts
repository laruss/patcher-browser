/**
 * How long a consent prompt waits before it gives up.
 *
 * Four minutes rather than the ten a plugin question gets: this one blocks a
 * command an agent — or a provisioning worktree — is sitting on, and a turn
 * parked on a prompt nobody is looking at is worse than a turn told to ask
 * again.
 *
 * Four rather than five because the answer travels back as the response to a
 * request the caller is still holding open, and undici — Node's `fetch` — gives
 * up on a response whose headers have not arrived in 300 s. At five, the client
 * always loses the race: the caller gets `UND_ERR_HEADERS_TIMEOUT` instead of an
 * answer, and the socket closing aborts the prompt off the user's screen at the
 * exact moment they may be deciding.
 *
 * Shared rather than restated per caller: the constraint belongs to the
 * transport, not to any one question, so a change to it has to reach every
 * prompt at once.
 *
 * The setup-script route sends its response head before the answer and streams
 * the answer in the body, so undici's ceiling does not bind there — the four
 * minutes are about people, not the socket. It keeps the same figure anyway: a
 * prompt nobody is looking at should not hold a provisioning lane open longer
 * than the one an agent is sitting on.
 */
export const CONSENT_INTERACTION_TIMEOUT_MS = 4 * 60 * 1000;

/** Wire caps from `consentPendingInteractionPayloadSchema`. */
export const CONSENT_SUBJECT_NAME_MAX = 200;
export const CONSENT_DETAIL_MAX = 500;

/**
 * The consent payload's caps are wire limits, and these strings come from a
 * plugin manifest, a caller's install source or a host path, none of which is
 * bounded by anything a route controls. Truncating keeps a long one from failing
 * the schema and reaching the caller as an unexplained refusal.
 */
export function capConsentText(value: string, max: number): string {
  if (value.length <= max) return value;
  // Never cut a surrogate pair in half. A lone surrogate renders as a
  // replacement glyph, and this string is the identity the user is being asked
  // to trust — corrupting it at the one boundary a caller controls is exactly
  // what should not happen here.
  const lastKept = value.charCodeAt(max - 2);
  const end = lastKept >= 0xd800 && lastKept <= 0xdbff ? max - 2 : max - 1;
  return `${value.slice(0, end)}…`;
}
