import path from "node:path";
import type { JsonValue } from "./generated/codex-app-server/schema/serde_json/JsonValue.js";

/**
 * The workspace policy Patcher hands Codex, as a permission profile.
 *
 * Codex's legacy `workspace-write` says only which roots are writable. It has
 * no way to say "this path inside a writable root is not yours", which is the
 * shape both of Patcher's protections need: the credential files a sandboxed
 * turn must not read, and the repository files that decide what git executes.
 * The profile system does have that shape — `filesystem` is a map from a path
 * to `read`, `write` or `deny` — so the policy moves here whole.
 *
 * Measured against codex-cli 0.150.1 rather than assumed, because almost none
 * of it is obvious:
 *
 * - A more specific entry beats a broader one: `deny` on a directory holds
 *   under `":root" = "read"`, and `read` on `.git/config` holds under a `write`
 *   on `.git`. Entries are still emitted broadest-first, so the list reads the
 *   way it resolves and does not depend on which rule wins.
 * - The deny is the kernel's, not the model's: inside a real turn, a `cat`
 *   through a symlink that points out of the workspace answers "Operation not
 *   permitted". The model is also *told* about the denied paths, and says so
 *   rather than trying — but that is a courtesy on top, not the mechanism.
 * - `deny` is a level, not a verb: it takes the read with the write. So the
 *   repository files are `read`, not `deny` — denying `.git/config` outright
 *   stops git from running at all ("unable to access '.git/config'").
 * - Codex excludes `.git` from the workspace grant on its own, whatever the
 *   sandbox mode, so `.git` has to be granted back explicitly or a turn in a
 *   plain checkout cannot stage its own work: `git add` fails on `index.lock`.
 *   A turn in a managed worktree kept working only because the worktree's
 *   gitdir is outside the workspace and Patcher grants it as a writable root.
 * - `":root" = "read"` is not the default. A profile that names only its
 *   writable roots cannot exec `/bin/sh`, so the full-disk read Codex's
 *   workspace-write mode allows has to be said out loud here.
 * - `network` has to be said out loud too: a profile that omits it inherits the
 *   restricted default, which would take the loopback the `patcher` CLI needs.
 *
 * The profile is selected by `default_permissions`, and both go through the
 * per-thread config overrides — not through `thread/start`'s own `sandbox`
 * field, which turns the profile off entirely (`activePermissionProfile` comes
 * back null and the grants revert to the legacy mode). `sandbox_mode` in the
 * same config map is the floor for the other direction: a Codex that does not
 * understand `default_permissions` ignores it silently, and without the floor
 * the session would fall back to whatever the machine's own config.toml says —
 * which may well be `danger-full-access`.
 */

export const CODEX_WORKSPACE_PERMISSION_PROFILE_ID = "patcher-workspace";

export interface BuildCodexWorkspacePermissionProfileArgs {
  /** The thread's working directory; `.git` under it is granted back. */
  workspacePath: string | undefined;
  /** Paths outside the workspace a workspace-write turn may still write. */
  writableRoots: readonly string[];
  /** Paths inside a writable root that stay readable but not writable. */
  protectedRepositoryPaths: readonly string[];
  /** Files a sandboxed turn must not read at all. */
  protectedCredentialPaths: readonly string[];
}

type CodexFilesystemAccess = "read" | "write" | "deny";

function assignEntry(
  entries: Record<string, CodexFilesystemAccess>,
  path: string | undefined,
  access: CodexFilesystemAccess,
): void {
  if (path === undefined || path.length === 0) return;
  entries[path] = access;
}

/**
 * The config overrides that put a workspace-write turn under the profile.
 *
 * Returned as one object per config key so the caller can merge it into the
 * overrides it already sends; `permissions` is a nested value rather than a
 * dotted key because the keys under it are absolute paths, which dots and
 * slashes make unspellable as a path expression.
 */
export function buildCodexWorkspacePermissionProfileConfig(
  args: BuildCodexWorkspacePermissionProfileArgs,
): { [key in string]?: JsonValue } {
  const entries: Record<string, CodexFilesystemAccess> = {};
  // Broadest first, narrowest last.
  entries[":root"] = "read";
  assignEntry(entries, args.workspacePath, "write");
  for (const root of args.writableRoots) {
    assignEntry(entries, root, "write");
  }
  if (args.workspacePath !== undefined && args.workspacePath.length > 0) {
    assignEntry(entries, path.join(args.workspacePath, ".git"), "write");
  }
  for (const protectedPath of args.protectedRepositoryPaths) {
    assignEntry(entries, protectedPath, "read");
  }
  for (const credentialPath of args.protectedCredentialPaths) {
    assignEntry(entries, credentialPath, "deny");
  }

  return {
    sandbox_mode: "workspace-write",
    default_permissions: CODEX_WORKSPACE_PERMISSION_PROFILE_ID,
    permissions: {
      [CODEX_WORKSPACE_PERMISSION_PROFILE_ID]: {
        // Open, as it is today. Closing it takes the local API off a TCP port
        // first — see docs/security.md.
        network: { enabled: true },
        filesystem: entries,
      },
    },
  };
}
