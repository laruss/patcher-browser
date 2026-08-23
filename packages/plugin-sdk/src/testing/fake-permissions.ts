import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  canonicalPermissions,
  pluginPermissionSchema,
  type PluginPermission,
} from "@patcher/domain";

/**
 * The fake host's half of `patcher.permissions`.
 *
 * It exists so a plugin's unit tests cannot pass on a manifest the real host
 * would refuse. The default is the host's default — **declared nothing,
 * reaches nothing gated** — so a suite that exercises `patcher.browser` or
 * `patcher.sdk` must say what the plugin asks for, and saying it wrong fails here
 * instead of on someone's machine.
 *
 * Say it by reading the plugin's own manifest, so the test cannot drift from
 * what ships — see {@link pluginPermissionsFromManifest}.
 *
 * Refusals mirror the server's by `name`, not by class — no runtime class
 * crosses that boundary, and tests match on the name.
 */

/**
 * The `patcher.permissions` of the plugin owning `from`, read off disk.
 *
 * Pass `import.meta.url` from the test. Reading the real manifest is the whole
 * point: a hand-written list in the test would be a second declaration, free
 * to say the plugin needs something it does not, or — worse — to keep passing
 * after the manifest drops an entry the code still uses.
 *
 * Walks up to the nearest `package.json` that declares `patcher.server`, so tests
 * in subdirectories work without naming a path.
 */
export function pluginPermissionsFromManifest(
  from: string,
): readonly PluginPermission[] {
  const declared = (
    readPluginManifestPatcher(from) as { permissions?: unknown }
  ).permissions;
  // Parsed rather than trusted: a manifest typo must fail the test the way it
  // fails the install, not silently grant nothing.
  return pluginPermissionSchema.array().parse(declared ?? []);
}

/**
 * The `patcher.sites` of the plugin owning `from`, read off disk.
 *
 * The companion to {@link pluginPermissionsFromManifest}, and needed for the
 * same reason plus one of its own: a page style names one of these patterns, so
 * a test that listed them by hand could register a style against a site the
 * manifest never declared — which is the one thing an install refuses.
 */
export function pluginSitesFromManifest(from: string): readonly string[] {
  const declared = (readPluginManifestPatcher(from) as { sites?: unknown })
    .sites;
  return pluginSitesSchema.parse(declared ?? []);
}

const pluginSitesSchema = z.array(z.string().min(1));

/**
 * The `patcher` block of the nearest `package.json` above `from` that declares
 * `patcher.server`, so tests in subdirectories work without naming a path.
 */
function readPluginManifestPatcher(from: string): object {
  let dir = from.startsWith("file:")
    ? dirname(fileURLToPath(from))
    : resolve(from);
  for (;;) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const manifest: unknown = JSON.parse(readFileSync(candidate, "utf8"));
      const patcher = (manifest as { patcher?: { server?: unknown } }).patcher;
      if (patcher !== undefined && typeof patcher.server === "string") {
        return patcher;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `no plugin package.json (one declaring "patcher.server") above ${from}`,
      );
    }
    dir = parent;
  }
}

export function createFakePermissionError(
  pluginId: string,
  permission: PluginPermission,
  what: string,
): Error {
  return Object.assign(
    new Error(
      `${what} needs the "${permission}" permission, which plugin ` +
        `"${pluginId}" does not declare. Add it to "patcher.permissions" in the ` +
        `plugin's package.json, then run \`patcher plugin reload ${pluginId}\`.`,
    ),
    { name: "PluginPermissionError", permission, pluginId },
  );
}

export interface FakePermissionGate {
  has(permission: PluginPermission): boolean;
  assert(permission: PluginPermission, what: string): void;
  readonly granted: readonly PluginPermission[];
}

export function createFakePermissionGate(
  pluginId: string,
  declared: readonly PluginPermission[] | undefined,
): FakePermissionGate {
  const granted = new Set(declared ?? []);
  return {
    granted: canonicalPermissions(declared),
    has(permission) {
      return granted.has(permission);
    },
    assert(permission, what) {
      if (!granted.has(permission)) {
        throw createFakePermissionError(pluginId, permission, what);
      }
    },
  };
}
