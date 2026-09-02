import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The credential an agent's shell carries instead of the app key.
 *
 * Until this existed, a turn's processes were handed `PATCHER_APP_KEY` — the
 * same key the app, the CLI and the launcher present — so "who is calling"
 * could only be answered by the caller declaring a thread in a header, which
 * anything with a shell can omit. Attribution, not a boundary, and the header's
 * own note in @patcher/server-contract said so.
 *
 * A thread key is derived from the app key and the thread id, so it *proves*
 * the thread rather than asserting it: it verifies for exactly one thread, it
 * cannot be turned back into the app key, and one thread's key is no use as
 * another's. That makes the thread a fact the server can charge a policy
 * against, which is what `agent-route-policy.ts` in the server does.
 *
 * **What this does not close.** The app key is a file on disk, readable by
 * anything running as the user, and an agent's sandbox restricts writes rather
 * than reads. So an agent that goes looking can still read the key and present
 * itself as the app. Not handing it over stops that from being the default and
 * makes going around Patcher a deliberate act rather than a free one — the same
 * position the plugin permission map holds, and it closes for the same reason:
 * a sandbox that restricts reads, or a machine whose data dir belongs to
 * another user. See docs/security.md.
 *
 * **Two credentials, because there are two lifetimes.** A derived key used to
 * be one string with no deadline in it, so an agent that kept the one handed to
 * its shell could present it after its turn ended and go on acting as that
 * thread. A stamped deadline could not fix that on its own: the processes
 * carrying a key outlive a turn on purpose — a terminal a turn opened is still
 * there tomorrow — and a refresh path without server-side revocation is just an
 * agent extending itself.
 *
 * So the lifetime is not a deadline but a state the server already keeps, and
 * there are two of them:
 *
 * - A **turn** key is accepted while its thread has a turn running. What an
 *   agent saves from its shell stops working when that turn is over.
 * - A **terminal** key is accepted while that terminal is open. That is the
 *   lifetime which legitimately outlives a turn, and it is one a person can
 *   see and end — a row on the server, a tab in the app.
 *
 * Neither can borrow the other's validity: the contexts below are separate, so
 * a turn key is not a terminal's even for the same thread. What the server
 * checks each against is in `thread-identity.ts`; this module only says what a
 * credential is and whether it is genuine.
 *
 * Node-only, so it lives here rather than beside the header names in
 * `app-key.ts` — that module is imported by the SPA and has to stay free of
 * Node built-ins.
 */

/**
 * Domain separation, so a thread key can never collide with some other value
 * derived from the same app key later, and so a future construction can change
 * without a v1 key verifying against it.
 *
 * Two contexts because there are two lifetimes, and one credential could not
 * have both: a turn's processes and a terminal outlive each other in different
 * directions. What actually keeps a turn's key from being read as a terminal's
 * is the message — a terminal's names the terminal it belongs to — and these
 * separate contexts are the domain separation on top of that, so a later change
 * to either message cannot make the two collide by accident.
 */
const TURN_API_KEY_CONTEXT = "patcher-thread-api-key:turn:v2";
const TERMINAL_API_KEY_CONTEXT = "patcher-thread-api-key:terminal:v2";

/**
 * What a presented credential looks like, and why it says which kind it is.
 *
 * The server has to know *which* state to check before it can accept anything
 * — a live turn, or an open terminal — so the kind cannot be inferred after the
 * fact. The terminal's own id rides along because that is the row whose state
 * decides, and it is inside the MAC: a caller cannot move a terminal key onto
 * another terminal's id, and cannot present a turn key as a terminal's.
 *
 * Base64url for the id rather than a raw one, because a terminal id has no
 * charset the schema pins and a `.` in it would make this ambiguous to parse.
 */
const TURN_CREDENTIAL_PREFIX = "pt2";
const TERMINAL_CREDENTIAL_PREFIX = "px2";

/** The environment variable a turn's processes receive the key in. */
export const PATCHER_THREAD_KEY_ENV = "PATCHER_THREAD_KEY";

export interface DeriveThreadApiKeyArgs {
  appApiKey: string;
  threadId: string;
}

export interface DeriveTerminalApiKeyArgs extends DeriveThreadApiKeyArgs {
  terminalId: string;
}

export interface VerifyThreadApiKeyArgs extends DeriveThreadApiKeyArgs {
  presented: string;
}

/** What a presented credential claims to be, once parsed. */
export type ThreadCredentialClaim =
  | { kind: "turn" }
  | { kind: "terminal"; terminalId: string };

function requireDerivationInputs(args: DeriveThreadApiKeyArgs): void {
  if (args.appApiKey.length === 0) {
    throw new Error("cannot derive a thread API key from an empty app API key");
  }
  if (args.threadId.length === 0) {
    throw new Error("cannot derive a thread API key without a thread id");
  }
}

function mac(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("base64url");
}

/**
 * The credential a turn's own processes carry.
 *
 * Accepted while the thread has a turn running, and that is the whole point of
 * separating it: what an agent saves from its shell stops working when the
 * turn it was given for is over. A process that has to outlive a turn on
 * purpose — a terminal — gets the other one below rather than this.
 */
export function deriveThreadTurnApiKey(args: DeriveThreadApiKeyArgs): string {
  requireDerivationInputs(args);
  return `${TURN_CREDENTIAL_PREFIX}.${mac(
    args.appApiKey,
    `${TURN_API_KEY_CONTEXT}:${args.threadId}`,
  )}`;
}

/**
 * The credential a thread's terminal carries.
 *
 * Accepted while that terminal is open, which is a lifetime a person can see
 * and end: a terminal is a row on the server and a tab in the app. So an agent
 * cannot extend its own reach by keeping a credential — it can only keep a
 * terminal, which is visible and closable.
 */
export function deriveTerminalApiKey(args: DeriveTerminalApiKeyArgs): string {
  requireDerivationInputs(args);
  if (args.terminalId.length === 0) {
    throw new Error("cannot derive a terminal API key without a terminal id");
  }
  const encodedTerminalId = Buffer.from(args.terminalId, "utf8").toString(
    "base64url",
  );
  return `${TERMINAL_CREDENTIAL_PREFIX}.${encodedTerminalId}.${mac(
    args.appApiKey,
    `${TERMINAL_API_KEY_CONTEXT}:${args.threadId}:${args.terminalId}`,
  )}`;
}

/**
 * What this credential claims, without deciding whether it is genuine.
 *
 * Parsing and verifying are separate because the caller needs the claim to
 * know which secret to check it against — and, after that, which state decides
 * whether it is still good.
 */
export function parseThreadCredential(
  presented: string,
): ThreadCredentialClaim | undefined {
  const [prefix, ...rest] = presented.split(".");
  // Every part has to carry something. An empty mac would be refused by the
  // verification below anyway, but a claim is what tells the server which
  // state to look up, and "no credential at all" is not one.
  if (rest.some((part) => part.length === 0)) return undefined;
  if (prefix === TURN_CREDENTIAL_PREFIX && rest.length === 1) {
    return { kind: "turn" };
  }
  if (prefix === TERMINAL_CREDENTIAL_PREFIX && rest.length === 2) {
    const terminalId = Buffer.from(rest[0] as string, "base64url").toString(
      "utf8",
    );
    return terminalId.length === 0
      ? undefined
      : { kind: "terminal", terminalId };
  }
  return undefined;
}

/**
 * Whether `presented` is a genuine credential for this thread, and which kind.
 *
 * A mismatch is simply not this thread's caller, the same way a wrong app key
 * is not a known client: the middleware refuses it rather than this throwing.
 * Genuine is not the same as *accepted* — the state that decides that belongs
 * to the server, which is where the two lifetimes are checked.
 */
export function verifyThreadApiKey(
  args: VerifyThreadApiKeyArgs,
): ThreadCredentialClaim | undefined {
  if (
    args.appApiKey.length === 0 ||
    args.threadId.length === 0 ||
    args.presented.length === 0
  ) {
    return undefined;
  }
  const claim = parseThreadCredential(args.presented);
  if (claim === undefined) return undefined;
  const expected =
    claim.kind === "turn"
      ? deriveThreadTurnApiKey({
          appApiKey: args.appApiKey,
          threadId: args.threadId,
        })
      : deriveTerminalApiKey({
          appApiKey: args.appApiKey,
          threadId: args.threadId,
          terminalId: claim.terminalId,
        });
  const expectedBytes = Buffer.from(expected, "utf8");
  const offeredBytes = Buffer.from(args.presented, "utf8");
  // Length first: `timingSafeEqual` throws on a mismatch, and the length of a
  // fixed-width digest is not the part worth hiding.
  if (offeredBytes.length !== expectedBytes.length) return undefined;
  return timingSafeEqual(offeredBytes, expectedBytes) ? claim : undefined;
}
