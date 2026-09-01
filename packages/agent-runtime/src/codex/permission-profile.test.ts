import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCodexWorkspacePermissionProfileConfig,
  CODEX_WORKSPACE_PERMISSION_PROFILE_ID,
} from "./permission-profile.js";

/**
 * What Patcher asks Codex to enforce for a workspace turn.
 *
 * Every expectation here was measured against codex-cli 0.150.1 before it was
 * written down; `permission-profile.ts` says which measurement and why.
 */

const WORKSPACE = "/tmp/worktree";

function filesystemEntries(
  config: ReturnType<typeof buildCodexWorkspacePermissionProfileConfig>,
): Record<string, string> {
  const permissions = config["permissions"] as Record<
    string,
    { filesystem: Record<string, string> }
  >;
  return permissions[CODEX_WORKSPACE_PERMISSION_PROFILE_ID]?.filesystem ?? {};
}

function buildProfile(
  overrides: Partial<
    Parameters<typeof buildCodexWorkspacePermissionProfileConfig>[0]
  > = {},
) {
  return buildCodexWorkspacePermissionProfileConfig({
    networkRestricted: false,
    protectedCredentialPaths: [],
    protectedRepositoryPaths: [],
    workspacePath: WORKSPACE,
    writableRoots: [],
    ...overrides,
  });
}

describe("the Codex workspace permission profile", () => {
  it("grants the workspace, its own .git, and the roots it was handed", () => {
    const entries = filesystemEntries(
      buildProfile({ writableRoots: ["/repo/.git", "/repo/.git/objects"] }),
    );

    // `.git` is granted back explicitly because Codex excludes it from the
    // workspace on its own, in every sandbox mode: without this a turn in a
    // plain checkout cannot stage its own work — `git add` fails on
    // `index.lock`.
    expect(entries).toEqual({
      ":root": "read",
      [WORKSPACE]: "write",
      "/repo/.git": "write",
      "/repo/.git/objects": "write",
      [path.join(WORKSPACE, ".git")]: "write",
    });
  });

  it("says the full-disk read and the network out loud", () => {
    // Neither is the default under a profile: one would leave a turn unable to
    // exec `/bin/sh`, and an omitted `network` inherits the restricted default,
    // so "open" has to be written down to be true.
    const config = buildProfile();

    expect(filesystemEntries(config)[":root"]).toBe("read");
    expect(config["permissions"]).toMatchObject({
      [CODEX_WORKSPACE_PERMISSION_PROFILE_ID]: {
        network: { enabled: true },
      },
    });
  });

  it("closes the network when the install asked for that", () => {
    // The `patcher` CLI does not go with it: a turn reaches Patcher through an
    // MCP tool Codex spawns outside the command sandbox. What it costs is a
    // prompt per outbound connection, which is why it is off by default.
    expect(
      buildProfile({ networkRestricted: true })["permissions"],
    ).toMatchObject({
      [CODEX_WORKSPACE_PERMISSION_PROFILE_ID]: {
        network: { enabled: false },
      },
    });
    // And the filesystem side is untouched by it.
    expect(
      filesystemEntries(buildProfile({ networkRestricted: true }))[":root"],
    ).toBe("read");
  });

  it("keeps the repository's execution files readable, not denied", () => {
    // `deny` is a level rather than a verb — it takes the read with the write,
    // and git cannot run without reading its own config.
    const entries = filesystemEntries(
      buildProfile({
        writableRoots: ["/repo/.git"],
        protectedRepositoryPaths: ["/repo/.git/config", "/repo/.git/hooks"],
      }),
    );

    expect(entries["/repo/.git/config"]).toBe("read");
    expect(entries["/repo/.git/hooks"]).toBe("read");
    expect(entries["/repo/.git"]).toBe("write");
  });

  it("denies the credential files outright", () => {
    const entries = filesystemEntries(
      buildProfile({
        protectedCredentialPaths: ["/data/app-key", "/data/patcher.db"],
      }),
    );

    expect(entries["/data/app-key"]).toBe("deny");
    expect(entries["/data/patcher.db"]).toBe("deny");
  });

  it("names the narrow entries after the broad ones they sit inside", () => {
    // A more specific entry wins whichever way Codex resolves the list, and
    // emitting broadest-first means the list reads the way it resolves.
    const entries = Object.keys(
      filesystemEntries(
        buildProfile({
          writableRoots: ["/repo/.git"],
          protectedRepositoryPaths: ["/repo/.git/config"],
          protectedCredentialPaths: ["/data/app-key"],
        }),
      ),
    );

    expect(entries).toEqual([
      ":root",
      WORKSPACE,
      "/repo/.git",
      path.join(WORKSPACE, ".git"),
      "/repo/.git/config",
      "/data/app-key",
    ]);
  });

  it("keeps a linked worktree's `.git` pointer file read-only", () => {
    // The one path that is both: it is the workspace's own `.git`, which the
    // profile grants back so git can work, and it is a protected file, because
    // rewriting it aims git at a gitdir the turn owns outright. The protection
    // is assigned second, so it is the one that stands.
    const pointerFile = path.join(WORKSPACE, ".git");
    const entries = filesystemEntries(
      buildProfile({ protectedRepositoryPaths: [pointerFile] }),
    );

    expect(entries[pointerFile]).toBe("read");
  });

  it("carries the legacy floor for a Codex that ignores the profile", () => {
    // An unknown config key is not an error, so a Codex that does not
    // understand `default_permissions` would fall back to the machine's own
    // config.toml — which may well say danger-full-access.
    expect(buildProfile()).toMatchObject({
      sandbox_mode: "workspace-write",
      default_permissions: CODEX_WORKSPACE_PERMISSION_PROFILE_ID,
    });
  });

  it("has nothing to say about a workspace it was not given", () => {
    const entries = filesystemEntries(
      buildProfile({ workspacePath: undefined, writableRoots: ["/repo"] }),
    );

    expect(entries).toEqual({ ":root": "read", "/repo": "write" });
  });
});
