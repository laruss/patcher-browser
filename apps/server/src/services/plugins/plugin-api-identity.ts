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
 * **The anonymous case is refused**, which it was not for most of this file's
 * life. "No identity is the app, the CLI, or anything else local" was true and
 * useless: a plugin holds `patcher.server.loopbackBaseUrl`, so omitting the
 * header pair skipped the path→permission map entirely. Every non-plugin
 * client now presents its own key — see ../../app-identity.ts — and a request
 * carrying neither is a 401.
 *
 * What that does and does not buy, stated plainly because this is the file an
 * auditor reads first:
 *
 * - `patcher.sdk` traffic is identified and gated at the HTTP layer, so a plugin
 *   gets the same answer whichever way it asks — through the SDK object or
 *   through `fetch` at the loopback URL, which is a supported thing to do.
 * - Going around the SDK no longer means going around the gate, because there
 *   is no longer an unidentified caller for a plugin to imitate.
 * - It is still not a boundary against a hostile plugin. A plugin process is
 *   not sandboxed: it has `node:fs` and runs as the user, so it can read the
 *   app's key file exactly as the CLI does. Closing that needs the sandbox,
 *   not another header. See docs/security.md.
 *
 * Keys are minted per server run and kept in memory. Nothing persists: a
 * restart re-mints, and there is no file for another local process to read.
 * The app's key is the one credential here that does live in a file, because
 * clients that outlive a server restart have to find it.
 */

/** Names the plugin; meaningless without the key. */
export const PLUGIN_API_ID_HEADER = "x-patcher-plugin-id";
/** Proves the request came from where that plugin's key was handed out. */
export const PLUGIN_API_KEY_HEADER = "x-patcher-plugin-key";

export interface PluginApiIdentities {
  /** This plugin's key, minted on first use and stable until restart. */
  keyFor(pluginId: string): string;
  /**
   * The plugin a request belongs to, or null when it carries no plugin
   * identity — which the caller then has to answer for another way, with the
   * app key or by being one of the routes that needs neither.
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
