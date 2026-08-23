/**
 * How a plugin's own imports resolve, wherever the plugin is loaded.
 *
 * Extracted from plugin-runtime.ts when plugins started loading in their own
 * process: the plugin host runs its own jiti, and a jiti without this alias
 * fails on the first plugin that imports anything — which is most of them, and
 * which shows up as a plugin process that dies before it can explain itself.
 * One copy, both loaders.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_SERVER_EXTERNALS } from "@patcher/plugin-build";

/**
 * Plugin server bundles leave `PLUGIN_SERVER_EXTERNALS` unresolved (see
 * @patcher/plugin-build), and plugin authors never have `@patcher/plugin-sdk` installed —
 * the scaffold maps that specifier to bundled `.d.ts` files only. Built and
 * packaged servers have no node_modules copy, so the server build ships a
 * self-contained SDK runtime bundle next to the server bundle and the loader
 * aliases the specifier to it.
 *
 * A source checkout has no such bundle, and a plugin root can sit anywhere on
 * disk (a `path:` install, or the data dir), so nothing along the plugin's own
 * directory chain resolves the specifier. This used to work by accident: pnpm's
 * hidden hoisted `node_modules/.pnpm/node_modules` is reachable from any
 * directory that Node's resolver happens to probe, and it holds every installed
 * package whether or not the importer declared it. Package managers with strict
 * per-package linking (bun's isolated linker) have no such directory, so the
 * checkout case is aliased explicitly to the workspace copy the server itself
 * resolves rather than left to the resolver's layout.
 */
const pluginSdkRuntimePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "plugin-sdk-runtime.js",
);

/**
 * The entry a plain Node consumer would load, deliberately ignoring the
 * workspace `source` export condition. A plugin tree sits anywhere on disk, and
 * an aliased TypeScript source entry would still have to resolve *its own*
 * imports from the plugin's directory chain — which fails. Published runtime
 * entries carry their dependencies or have none.
 */
function resolveRuntimeEntry(require_: NodeRequire, specifier: string): string {
  const resolved = require_.resolve(specifier);
  if (!/\.tsx?$/u.test(resolved)) return resolved;
  // Walk up for the manifest rather than resolving `<specifier>/package.json`:
  // an `exports` map that omits that subpath makes the direct resolve throw.
  let dir = dirname(resolved);
  for (;;) {
    const manifestPath = join(dir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        exports?: { "."?: Record<string, string> };
        main?: string;
      };
      const entry =
        manifest.exports?.["."]?.import ??
        manifest.exports?.["."]?.default ??
        manifest.main;
      return entry === undefined ? resolved : join(dir, entry);
    }
    const parent = dirname(dir);
    if (parent === dir) return resolved;
    dir = parent;
  }
}

function resolveWorkspaceExternalsAlias(): Record<string, string> | undefined {
  const require_ = createRequire(import.meta.url);
  const alias: Record<string, string> = {};
  for (const specifier of PLUGIN_SERVER_EXTERNALS) {
    try {
      alias[specifier] = resolveRuntimeEntry(require_, specifier);
    } catch {
      // Nothing to alias for this one; a load that needs it fails with its own
      // "Cannot find module" naming the real problem.
    }
  }
  return Object.keys(alias).length === 0 ? undefined : alias;
}

export const pluginExternalsAlias: Record<string, string> | undefined =
  existsSync(pluginSdkRuntimePath)
    ? { "@patcher/plugin-sdk": pluginSdkRuntimePath }
    : resolveWorkspaceExternalsAlias();
