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
 * **No expiry.** The app key is stable across restarts, so a derived key is
 * too, and an agent that keeps one can present it after its turn ends. Expiry
 * needs either a server-side store or a refresh path for turns that outlive a
 * stamped deadline; the thread is the unit the policy is written against, and a
 * key that is still that thread's is still charged that thread's limits.
 *
 * Node-only, so it lives here rather than beside the header names in
 * `app-key.ts` — that module is imported by the SPA and has to stay free of
 * Node built-ins.
 */

/**
 * Domain separation, so a thread key can never collide with some other value
 * derived from the same app key later, and so a future construction can change
 * without a v1 key verifying against it.
 */
const THREAD_API_KEY_CONTEXT = "patcher-thread-api-key:v1";

/** The environment variable a turn's processes receive the key in. */
export const PATCHER_THREAD_KEY_ENV = "PATCHER_THREAD_KEY";

export interface DeriveThreadApiKeyArgs {
  appApiKey: string;
  threadId: string;
}

export interface VerifyThreadApiKeyArgs extends DeriveThreadApiKeyArgs {
  presented: string;
}

export function deriveThreadApiKey(args: DeriveThreadApiKeyArgs): string {
  if (args.appApiKey.length === 0) {
    throw new Error("cannot derive a thread API key from an empty app API key");
  }
  if (args.threadId.length === 0) {
    throw new Error("cannot derive a thread API key without a thread id");
  }
  return createHmac("sha256", args.appApiKey)
    .update(`${THREAD_API_KEY_CONTEXT}:${args.threadId}`)
    .digest("base64url");
}

/**
 * Whether `presented` is the key for this thread.
 *
 * A mismatch is simply not this thread's caller, the same way a wrong app key
 * is not a known client: the middleware refuses it rather than this throwing.
 */
export function verifyThreadApiKey(args: VerifyThreadApiKeyArgs): boolean {
  if (
    args.appApiKey.length === 0 ||
    args.threadId.length === 0 ||
    args.presented.length === 0
  ) {
    return false;
  }
  const expected = Buffer.from(
    deriveThreadApiKey({ appApiKey: args.appApiKey, threadId: args.threadId }),
    "utf8",
  );
  const offered = Buffer.from(args.presented, "utf8");
  // Length first: `timingSafeEqual` throws on a mismatch, and the length of a
  // fixed-width digest is not the part worth hiding.
  if (offered.length !== expected.length) return false;
  return timingSafeEqual(offered, expected);
}
