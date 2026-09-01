import type { Context } from "hono";

/**
 * Which plugin a request came from, for the routes that have to know.
 *
 * The `/api/v1` gate already resolves this to charge a plugin the permissions it
 * declared, and then throws the answer away — every route below it sees a caller
 * that either passed the map or did not. That is the right shape for a
 * permission, and the wrong one for the two questions where the *identity*
 * matters rather than the price.
 *
 * The one that made this necessary: a consent prompt is answered by a person.
 * The gate for that is the declared-thread header — an agent mid-turn sends one,
 * the app does not — which is exactly right about turns and silent about
 * plugins, because a plugin authenticates with its own id and key and sends no
 * thread header at all. So a plugin holding `threads` could answer a prompt
 * raised for somebody else, and the timeline would record the *user* as having
 * allowed it. That is the record the prompt exists to leave.
 *
 * Recorded here rather than re-derived at the route: the gate has already
 * verified the id against the plugin's key, and a second resolution from headers
 * would be a second thing to keep honest.
 */

export const PLUGIN_API_ID_CONTEXT_KEY = "patcherPluginApiId";

declare module "hono" {
  interface ContextVariableMap {
    [PLUGIN_API_ID_CONTEXT_KEY]: string | undefined;
  }
}

export interface PluginApiIdReader {
  get(key: typeof PLUGIN_API_ID_CONTEXT_KEY): string | undefined;
}

/** Records the plugin a verified request speaks for, for later routes. */
export function setPluginApiId(context: Context, pluginId: string): void {
  context.set(PLUGIN_API_ID_CONTEXT_KEY, pluginId);
}

/** The plugin this request is from, or undefined for anyone else. */
export function getPluginApiId(context: PluginApiIdReader): string | undefined {
  return context.get(PLUGIN_API_ID_CONTEXT_KEY);
}
