import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The credential an agent that is *not* Patcher's carries instead of the app
 * key.
 *
 * The fourth identity, beside a plugin, a turn and the app. It exists because
 * of a sentence `browser-external-access.ts` in @patcher/domain had to write
 * about the setting that came before it: the level decides whether an agent
 * outside Patcher may drive the browser, and the caller it decides about is
 * holding the app key while it asks. The app key is a 0600 file any process
 * running as the user can read, and it opens the whole API — threads,
 * terminals, the file RPC, the settings including that very level. So the gate
 * was a default rather than a boundary, and this is what makes the difference:
 * a credential that opens the browser and nothing else, that a person issued on
 * purpose, and that they can see in a list and take back.
 *
 * **Derived, so nothing stores it.** `pa1.<grantId>.<HMAC(appKey, …grantId)>`,
 * the same construction a thread credential uses one module over. The server
 * needs no table of live keys and no way to leak one: given the grant id in the
 * credential it re-derives what the credential must be and compares. Losing the
 * app key file rotates every grant at once, which is the correct behaviour for
 * a key derived from it.
 *
 * **Its lifetime is the grant row**, exactly as a terminal credential's is the
 * terminal. That is the property a stamped deadline could not have given: an
 * agent handed one of these keeps the *string* forever — it is in its MCP
 * config or its shell — and what stops it is a row a person can revoke from
 * Settings, after which the next request is refused. Nothing to expire, nothing
 * to refresh, nothing an agent can extend for itself.
 *
 * **What it is not.** It is not a secret an agent cannot get around. The app
 * key file is still on disk and still readable by anything running as the user,
 * so an agent that goes looking can still present itself as the app — the same
 * thing `thread-api-key.ts` says about itself, for the same reason, and the
 * same thing docs/security.md says about every local gate. What it buys is that
 * the *supported* path is the narrow one, so an agent reaching past the browser
 * has done something deliberate rather than been handed the machine by default.
 *
 * Node-only for the same reason as its neighbour: `node:crypto`, so it lives
 * here rather than beside the header names, which the SPA imports.
 */

/**
 * Domain separation, so a value derived from the app key for something else can
 * never verify as a grant, and so a future construction can change without a v1
 * credential verifying against it.
 */
const AGENT_ACCESS_KEY_CONTEXT = "patcher-agent-access:v1";

/** What a presented credential looks like, so the id can be read off it. */
const AGENT_ACCESS_CREDENTIAL_PREFIX = "pa1";

/** The environment variable an agent outside Patcher receives the key in. */
export const PATCHER_AGENT_KEY_ENV = "PATCHER_AGENT_KEY";

export interface DeriveAgentAccessKeyArgs {
  appApiKey: string;
  grantId: string;
}

export interface VerifyAgentAccessKeyArgs extends DeriveAgentAccessKeyArgs {
  presented: string;
}

/**
 * The credential for one grant.
 *
 * The id rides in the clear, because the server has to know *which* row decides
 * before it can check anything, and because a person reading a config file or a
 * shell history should be able to tell which grant they are looking at and go
 * revoke it. It is inside the MAC as well, so it cannot be moved onto another
 * grant's id.
 *
 * Not base64url, unlike the terminal id in `thread-api-key.ts`. That id comes
 * from elsewhere and has no charset anything pins; a grant id is minted by
 * `createBrowserAccessGrantId` from an alphabet that has no `.` in it, so it
 * survives the split unencoded and stays legible. The guard below is what keeps
 * that true if the minter ever changes.
 */
export function deriveAgentAccessKey(args: DeriveAgentAccessKeyArgs): string {
  if (args.appApiKey.length === 0) {
    throw new Error("cannot derive an agent access key from an empty app key");
  }
  if (args.grantId.length === 0) {
    throw new Error("cannot derive an agent access key without a grant id");
  }
  if (args.grantId.includes(".")) {
    throw new Error(
      `a grant id cannot contain '.': it is the separator this credential is parsed on (got '${args.grantId}')`,
    );
  }
  return `${AGENT_ACCESS_CREDENTIAL_PREFIX}.${args.grantId}.${createHmac(
    "sha256",
    args.appApiKey,
  )
    .update(`${AGENT_ACCESS_KEY_CONTEXT}:${args.grantId}`)
    .digest("base64url")}`;
}

/**
 * The grant this credential claims to be for, without deciding whether it is
 * genuine — the caller needs the id to know what to check it against, and after
 * that which row decides whether it is still good.
 *
 * Undefined for anything that is not one of these at all, which is how the
 * server tells "presented no grant" from "presented a bad one".
 */
export function parseAgentAccessCredential(
  presented: string,
): { grantId: string } | undefined {
  const parts = presented.split(".");
  if (parts.length !== 3) return undefined;
  const [prefix, grantId, mac] = parts as [string, string, string];
  if (prefix !== AGENT_ACCESS_CREDENTIAL_PREFIX) return undefined;
  // Every part has to carry something: an empty mac would be refused below
  // anyway, but an empty id is not a claim the server could look anything up
  // for, and "no grant at all" is not one either.
  if (grantId.length === 0 || mac.length === 0) return undefined;
  return { grantId };
}

/**
 * Whether `presented` is genuinely this grant's credential.
 *
 * Genuine is not the same as *accepted*: the row this names may have been
 * revoked or deleted since, and that is the server's question rather than this
 * module's. A mismatch resolves to false rather than throwing, the same way a
 * wrong app key is simply not a known client.
 */
export function verifyAgentAccessKey(args: VerifyAgentAccessKeyArgs): boolean {
  if (
    args.appApiKey.length === 0 ||
    args.grantId.length === 0 ||
    args.presented.length === 0 ||
    args.grantId.includes(".")
  ) {
    return false;
  }
  const expected = Buffer.from(deriveAgentAccessKey(args), "utf8");
  const offered = Buffer.from(args.presented, "utf8");
  // Length first: `timingSafeEqual` throws on a mismatch, and the length of a
  // fixed-width digest behind a known id is not the part worth hiding.
  if (offered.length !== expected.length) return false;
  return timingSafeEqual(offered, expected);
}
