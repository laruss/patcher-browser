import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Who is calling `/api/v1`.
 *
 * `patcher.sdk` is an HTTP client for Patcher's own API and every plugin is handed the
 * loopback URL in `patcher.server.loopbackBaseUrl`, so the API sees plugin traffic
 * and app traffic as the same thing: a local request from a trusted origin.
 * Gating the `patcher.sdk` object therefore gates the polite way in and nothing
 * else. This is how a request says which plugin it belongs to, so the same
 * permissions can be enforced where the traffic actually is.
 *
 * **In-process this is cooperative, not enforced**, and that is not a defect
 * to be fixed here. A plugin shares the server's memory: it can read another
 * plugin's key, or simply send no header at all and be taken for the app.
 * Plan Phase 7 is what makes the header the only way in — once plugins run in
 * their own process, the server can require identity on that socket and refuse
 * the anonymous case for everything that arrives on it.
 *
 * What it buys before then:
 *
 * - `patcher.sdk` traffic is identified and gated at the HTTP layer, so a plugin
 *   gets the same answer whichever way it asks — through the SDK object or
 *   through `fetch` at the loopback URL, which is a supported thing to do.
 * - The mechanism, the header shape and the path→permission map are the parts
 *   a plugin host has to be built against, and they exist and are tested
 *   before the process split rather than being invented during it.
 *
 * Keys are minted per server run and kept in memory. Nothing persists: a
 * restart re-mints, and there is no file for another local process to read.
 */

/** Names the plugin; meaningless without the key. */
export const PLUGIN_API_ID_HEADER = "x-patcher-plugin-id";
/** Proves the request came from where that plugin's key was handed out. */
export const PLUGIN_API_KEY_HEADER = "x-patcher-plugin-key";

export interface PluginApiIdentities {
  /** This plugin's key, minted on first use and stable until restart. */
  keyFor(pluginId: string): string;
  /**
   * The plugin a request belongs to, or null when it carries no identity —
   * which is the app, the CLI, and anything else local.
   *
   * A header pair that does not verify returns null rather than throwing: an
   * unverified caller is simply not a plugin, and treating it as a hard error
   * would turn a stale key after restart into a crash instead of a retry.
   */
  resolve(headers: {
    id: string | undefined;
    key: string | undefined;
  }): string | null;
  /** Drops a plugin's key, so a removed plugin's copy stops verifying. */
  forget(pluginId: string): void;
}

/** The header pair, for a caller that sets headers itself (the websocket). */
export function pluginApiHeaders(args: {
  pluginId: string;
  key: string;
}): Record<string, string> {
  return {
    [PLUGIN_API_ID_HEADER]: args.pluginId,
    [PLUGIN_API_KEY_HEADER]: args.key,
  };
}

/**
 * A `fetch` that signs every request as this plugin, for the SDK client it is
 * given. Separated from the client so the one thing that makes the whole gate
 * live — that the headers are actually attached — is testable without a
 * listening socket.
 *
 * Caller headers are preserved and then overridden: a plugin cannot present
 * itself as another by setting these itself, at least not through `patcher.sdk`.
 */
export function createPluginApiFetch(args: {
  pluginId: string;
  key: string;
  fetch?: typeof fetch;
}): typeof fetch {
  const inner = args.fetch ?? fetch;
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set(PLUGIN_API_ID_HEADER, args.pluginId);
    headers.set(PLUGIN_API_KEY_HEADER, args.key);
    return inner(input, { ...init, headers });
  };
}

export function createPluginApiIdentities(): PluginApiIdentities {
  const keys = new Map<string, string>();
  return {
    keyFor(pluginId) {
      let key = keys.get(pluginId);
      if (key === undefined) {
        key = randomBytes(32).toString("base64url");
        keys.set(pluginId, key);
      }
      return key;
    },
    resolve({ id, key }) {
      if (id === undefined || key === undefined) return null;
      const expected = keys.get(id);
      if (expected === undefined) return null;
      const presented = Buffer.from(key, "utf8");
      const known = Buffer.from(expected, "utf8");
      if (presented.length !== known.length) return null;
      return timingSafeEqual(presented, known) ? id : null;
    },
    forget(pluginId) {
      keys.delete(pluginId);
    },
  };
}
