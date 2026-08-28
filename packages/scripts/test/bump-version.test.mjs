import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { bumpVersion } from "../../../scripts/bump-version.mjs";
import {
  deriveNightlyVersion,
  prepareNightlyVersion,
} from "../../../scripts/prepare-nightly-version.mjs";
import { extractChangelogEntry } from "../../../scripts/changelog-release-notes.mjs";

const scriptPath = fileURLToPath(
  new URL("../../../scripts/bump-version.mjs", import.meta.url),
);
const changelogNotesScriptPath = fileURLToPath(
  new URL("../../../scripts/changelog-release-notes.mjs", import.meta.url),
);
const testRoots = [];

function createPackageJson({ name, version }) {
  return `${JSON.stringify({ name, version, type: "module" }, null, 2)}\n`;
}

function createTestRepo({ patcherAppVersion, desktopVersion }) {
  const repoRoot = mkdtempSync(join(tmpdir(), "patcher-bump-version-"));
  testRoots.push(repoRoot);

  mkdirSync(join(repoRoot, "packages", "patcher-app"), { recursive: true });
  mkdirSync(join(repoRoot, "apps", "desktop"), { recursive: true });
  writeFileSync(
    join(repoRoot, "packages", "patcher-app", "package.json"),
    createPackageJson({ name: "patcher-app", version: patcherAppVersion }),
  );
  writeFileSync(
    join(repoRoot, "apps", "desktop", "package.json"),
    createPackageJson({ name: "@patcher/desktop", version: desktopVersion }),
  );

  return repoRoot;
}

function readVersion(repoRoot, packagePath) {
  return JSON.parse(readFileSync(join(repoRoot, packagePath), "utf8")).version;
}

function readPackageContent(repoRoot, packagePath) {
  return readFileSync(join(repoRoot, packagePath), "utf8");
}

function runScript(repoRoot, args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATCHER_BUMP_VERSION_REPO_ROOT: repoRoot,
    },
  });
}

afterEach(() => {
  for (const testRoot of testRoots.splice(0)) {
    rmSync(testRoot, { force: true, recursive: true });
  }
});

describe("bump-version", () => {
  it("exits non-zero for an invalid version argument", () => {
    const repoRoot = createTestRepo({
      patcherAppVersion: "0.0.6",
      desktopVersion: "0.0.6",
    });
    const result = runScript(repoRoot, ["not-semver"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid version: not-semver");
    expect(readVersion(repoRoot, "packages/patcher-app/package.json")).toBe(
      "0.0.6",
    );
    expect(readVersion(repoRoot, "apps/desktop/package.json")).toBe("0.0.6");
  });

  it("rejects a bump lower than the highest current target version", () => {
    const repoRoot = createTestRepo({
      patcherAppVersion: "0.0.6",
      desktopVersion: "0.0.9",
    });
    const originalPatcherAppContent = readPackageContent(
      repoRoot,
      "packages/patcher-app/package.json",
    );
    const originalDesktopContent = readPackageContent(
      repoRoot,
      "apps/desktop/package.json",
    );
    const result = runScript(repoRoot, ["0.0.7"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "New version 0.0.7 must be greater than current max 0.0.9 across patcher-app=0.0.6 @patcher/desktop=0.0.9.",
    );
    expect(
      readPackageContent(repoRoot, "packages/patcher-app/package.json"),
    ).toBe(originalPatcherAppContent);
    expect(readPackageContent(repoRoot, "apps/desktop/package.json")).toBe(
      originalDesktopContent,
    );
  });

  it("updates both package versions for a valid version argument", () => {
    const repoRoot = createTestRepo({
      patcherAppVersion: "0.0.6",
      desktopVersion: "0.0.6",
    });
    const result = runScript(repoRoot, ["0.0.7"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Bumped: patcher-app + @patcher/desktop → 0.0.7",
    );
    expect(readVersion(repoRoot, "packages/patcher-app/package.json")).toBe(
      "0.0.7",
    );
    expect(readVersion(repoRoot, "apps/desktop/package.json")).toBe("0.0.7");
  });

  it("restores the first package file when the second rename fails", async () => {
    const repoRoot = createTestRepo({
      patcherAppVersion: "0.0.6",
      desktopVersion: "0.0.6",
    });
    const originalPatcherAppContent = readPackageContent(
      repoRoot,
      "packages/patcher-app/package.json",
    );
    const originalDesktopContent = readPackageContent(
      repoRoot,
      "apps/desktop/package.json",
    );
    let renameCalls = 0;

    await expect(
      bumpVersion({
        args: ["0.0.7"],
        fileSystem: {
          readFile,
          rename: async (from, to) => {
            renameCalls += 1;

            if (renameCalls === 2) {
              throw new Error("simulated rename failure");
            }

            await rename(from, to);
          },
          unlink,
          writeFile,
        },
        log: () => {},
        repoRoot,
      }),
    ).rejects.toThrow("simulated rename failure");

    expect(renameCalls).toBe(2);
    expect(
      readPackageContent(repoRoot, "packages/patcher-app/package.json"),
    ).toBe(originalPatcherAppContent);
    expect(readPackageContent(repoRoot, "apps/desktop/package.json")).toBe(
      originalDesktopContent,
    );
    expect(
      readdirSync(join(repoRoot, "packages", "patcher-app")),
    ).not.toContainEqual(expect.stringMatching(/^\.tmp-/u));
    expect(readdirSync(join(repoRoot, "apps", "desktop"))).not.toContainEqual(
      expect.stringMatching(/^\.tmp-/u),
    );
  });
});

describe("prepare-nightly-version", () => {
  it("derives a unique next-patch prerelease from the workflow run", () => {
    expect(deriveNightlyVersion("1.2.3", "123456", "2")).toBe(
      "1.2.4-nightly.123456.2",
    );
    expect(deriveNightlyVersion("1.2.3-beta.4", "123456", "2")).toBe(
      "1.2.4-nightly.123456.2",
    );
  });

  it("rejects workflow identifiers that are not semver-safe integers", () => {
    expect(() => deriveNightlyVersion("1.2.3", "run-1", "1")).toThrow(
      "GITHUB_RUN_ID must be a positive integer",
    );
    expect(() => deriveNightlyVersion("1.2.3", "1", "0")).toThrow(
      "GITHUB_RUN_ATTEMPT must be a positive integer",
    );
  });

  it("updates patcher-app and desktop to the same nightly version", async () => {
    const repoRoot = createTestRepo({
      patcherAppVersion: "1.2.3",
      desktopVersion: "1.2.3",
    });

    await expect(
      prepareNightlyVersion({
        repoRoot,
        runAttempt: "1",
        runId: "987654",
      }),
    ).resolves.toBe("1.2.4-nightly.987654.1");
    expect(readVersion(repoRoot, "packages/patcher-app/package.json")).toBe(
      "1.2.4-nightly.987654.1",
    );
    expect(readVersion(repoRoot, "apps/desktop/package.json")).toBe(
      "1.2.4-nightly.987654.1",
    );
  });
});

describe("changelog-release-notes", () => {
  const changelog = [
    "# Changelog",
    "",
    "## 1.2.0-alpha.2",
    "",
    "What this build changed.",
    "",
    "### A section",
    "",
    "- A line.",
    "",
    "## 1.2.0-alpha.1",
    "",
    "The older entry.",
    "",
  ].join("\n");

  it("returns the entry body up to the next version heading", () => {
    expect(extractChangelogEntry({ changelog, version: "1.2.0-alpha.2" })).toBe(
      "What this build changed.\n\n### A section\n\n- A line.",
    );
    expect(extractChangelogEntry({ changelog, version: "1.2.0-alpha.1" })).toBe(
      "The older entry.",
    );
  });

  it("returns null for a version the changelog does not carry", () => {
    expect(extractChangelogEntry({ changelog, version: "9.9.9" })).toBeNull();
    expect(
      extractChangelogEntry({
        changelog: "# Changelog\n\n## 1.0.0\n\n## 0.9.0\n\nBody.\n",
        version: "1.0.0",
      }),
    ).toBeNull();
  });

  it("prints the entry, and fails naming the version when there is none", () => {
    const changelogPath = join(
      mkdtempSync(join(tmpdir(), "patcher-changelog-notes-")),
      "CHANGELOG.md",
    );
    writeFileSync(changelogPath, changelog);

    const found = spawnSync(
      process.execPath,
      [changelogNotesScriptPath, "1.2.0-alpha.2", changelogPath],
      { encoding: "utf8" },
    );
    expect(found.status).toBe(0);
    expect(found.stdout).toBe(
      "What this build changed.\n\n### A section\n\n- A line.\n",
    );

    const missing = spawnSync(
      process.execPath,
      [changelogNotesScriptPath, "9.9.9", changelogPath],
      { encoding: "utf8" },
    );
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("No CHANGELOG entry for 9.9.9");
  });

  // The workflow calls the script by a relative path, and a checkout reached
  // through a symlink used to make the entry-point check disagree with
  // `import.meta.url` — printing nothing and exiting 0, which reads as "no
  // entry" rather than as a failure.
  it("prints the entry when it is invoked through a symlink", () => {
    const linkDir = mkdtempSync(join(tmpdir(), "patcher-changelog-link-"));
    const linkPath = join(linkDir, "changelog-release-notes.mjs");
    const changelogPath = join(linkDir, "CHANGELOG.md");
    symlinkSync(changelogNotesScriptPath, linkPath);
    writeFileSync(changelogPath, changelog);

    const result = spawnSync(
      process.execPath,
      [linkPath, "1.2.0-alpha.2", changelogPath],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("What this build changed.");
  });

  // The release notes on the desktop release page come from this entry, so a
  // version bump that forgets one publishes a build that says nothing about
  // itself. Caught here rather than on the release page.
  it("carries an entry for the version the packages are on", () => {
    const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
    const version = JSON.parse(
      readFileSync(
        join(repoRoot, "packages", "patcher-app", "package.json"),
        "utf8",
      ),
    ).version;

    expect(
      extractChangelogEntry({
        changelog: readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8"),
        version,
      }),
    ).not.toBeNull();
  });
});
