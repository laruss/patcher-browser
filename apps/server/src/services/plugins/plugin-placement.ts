/**
 * Which plugins the server runs somewhere other than itself.
 *
 * Everything under this directory built the machinery for a plugin to live in
 * its own process; this file is the one that decides it happens. Until it
 * existed, `runPluginOutOfProcess` was supplied only by tests, so a shipped
 * server loaded every plugin — including one an agent had just written — into
 * the process that holds the database handle, the machine keys and the host
 * daemon's credentials.
 *
 * The rule is one line: **a plugin we did not ship runs in a plugin process.**
 *
 * Builtins stay in the server, and the reason is not that they are safer to
 * trust — it is that they are the same code as the server, released together
 * and reviewed together, so moving them buys isolation from ourselves while
 * costing the one thing the boundary cannot carry (a streaming HTTP response,
 * see plugin-remote-handle.ts). Installed and generated plugins are the
 * opposite case on both counts.
 *
 * Which process each of them gets is `plugin-supervisor.ts`, and the answer is
 * one apiece: several plugins in one unsandboxed process are one trust domain,
 * whatever the pipe between them is keyed by. So the two settings of
 * `PATCHER_PLUGIN_PROCESS` are the whole choice — a process per installed
 * plugin, or everything in the server.
 *
 * Placement is still best effort — `plugin-runtime.ts` falls back to the
 * server, loudly, for a plugin whose process will not start. This decides
 * where a plugin is *asked* to run, not where it ends up.
 */

import type { InstalledPluginRow } from "@patcher/db";

/** What the decision reads. A row, narrowed to the part that matters. */
export type PluginPlacementInput = Pick<InstalledPluginRow, "provenance">;

export function pluginProcessPolicy(args: {
  /**
   * `PATCHER_PLUGIN_PROCESS`. False loads every plugin in the server, which is what
   * the server did before this policy existed — the way back if putting
   * plugins in their own process turns out to break something in the field.
   */
  enabled: boolean;
}): (plugin: PluginPlacementInput) => boolean {
  if (!args.enabled) return () => false;
  return (plugin) => plugin.provenance !== "builtin";
}
