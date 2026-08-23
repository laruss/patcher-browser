import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { PLUGIN_SDK_VERSION } from "@patcher/domain";
import {
  createNpmResolverRun,
  resolveGitRef,
  resolveGitUpdate,
  resolveNpmUpdate,
} from "../../../src/services/plugins/update-resolver.js";

const run = promisify(execFile);
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function packumentFetch(
  versions: Record<string, { patcher?: string; sdk?: string; integrity?: string }>,
  tags: Record<string, string> = {},
): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify({
        versions: Object.fromEntries(
          Object.entries(versions).map(([version, metadata]) => [
            version,
            {
              version,
              engines: {
                ...(metadata.patcher ? { patcher: metadata.patcher } : {}),
                ...(metadata.sdk ? { patcherPluginSdk: metadata.sdk } : {}),
              },
              dist: {
                integrity: metadata.integrity ?? `sha512-${version}`,
              },
            },
          ]),
        ),
        "dist-tags": tags,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
}

function npmIntent(
  requestedSpec: string,
  specKind: "default" | "exact" | "tag" | "range",
) {
  return {
    packageName: "patcher-plugin-matrix",
    registry: "http://registry.test",
    requestedSpec,
    specKind,
  } as const;
}

describe("npm update candidate selection", () => {
  it("selects an older compatible range candidate and reports the newer block", async () => {
    const resolution = await resolveNpmUpdate({
      intent: npmIntent("^1.0.0", "range"),
      current: { version: "1.0.0", display: "patcher-plugin-matrix@1.0.0" },
      appVersion: "1.5.0",
      run: createNpmResolverRun({
        fetch: packumentFetch({
          "1.3.0": { patcher: ">=2" },
          "1.2.0": { patcher: ">=1" },
          "1.1.0-beta.1": { patcher: ">=1" },
          "1.0.0": { patcher: ">=1" },
        }),
      }),
    });

    expect(resolution).toMatchObject({
      outcome: "update-available",
      candidate: { version: "1.2.0" },
      blocked: {
        version: { version: "1.3.0" },
        reasons: [{ engine: "patcher", required: ">=2" }],
      },
    });
  });

  it("enforces SDK compatibility and returns incompatible when none match", async () => {
    const resolution = await resolveNpmUpdate({
      intent: npmIntent("", "default"),
      current: { version: "1.0.0", display: "patcher-plugin-matrix@1.0.0" },
      appVersion: "1.5.0",
      run: createNpmResolverRun({
        fetch: packumentFetch({
          "2.0.0": { sdk: ">=99" },
          "1.0.0": { sdk: ">=99" },
        }),
      }),
    });

    expect(resolution).toMatchObject({
      outcome: "incompatible",
      newest: { version: "2.0.0" },
      reasons: [
        {
          engine: "patcherPluginSdk",
          actual: PLUGIN_SDK_VERSION,
        },
      ],
    });
  });

  it("admits prereleases only when the requested semver spec includes one", async () => {
    const fetch = packumentFetch({
      "1.1.0-beta.1": {},
      "1.0.1": {},
      "1.0.0-beta.1": {},
    });
    const stable = await resolveNpmUpdate({
      intent: npmIntent("", "default"),
      current: { version: "1.0.0", display: "patcher-plugin-matrix@1.0.0" },
      appVersion: "1.0.0",
      run: createNpmResolverRun({ fetch }),
    });
    const prerelease = await resolveNpmUpdate({
      intent: npmIntent(">=1.0.0-beta.1 <1.0.0", "range"),
      current: {
        version: "1.0.0-alpha.1",
        display: "patcher-plugin-matrix@1.0.0-alpha.1",
      },
      appVersion: "1.0.0",
      run: createNpmResolverRun({ fetch }),
    });

    expect(stable).toMatchObject({
      outcome: "update-available",
      candidate: { version: "1.0.1" },
    });
    expect(prerelease).toMatchObject({
      outcome: "update-available",
      candidate: { version: "1.0.0-beta.1" },
    });
  });

  it("labels dev mode, ignores engines.patcher for selection, and still enforces SDK", async () => {
    const resolution = await resolveNpmUpdate({
      intent: npmIntent("", "default"),
      current: { version: "1.0.0", display: "patcher-plugin-matrix@1.0.0" },
      appVersion: "0.0.0",
      run: createNpmResolverRun({
        fetch: packumentFetch({
          "3.0.0": { patcher: ">=99", sdk: ">=99" },
          "2.0.0": { patcher: ">=99", sdk: `^${PLUGIN_SDK_VERSION}` },
          "1.0.0": {},
        }),
      }),
    });

    expect(resolution).toMatchObject({
      outcome: "update-available",
      devMode: true,
      candidate: { version: "2.0.0" },
      blocked: { version: { version: "3.0.0" } },
      packagedBuildProblems: [{ engine: "patcher", required: ">=99" }],
    });
  });

  it("tracks a dist-tag but pins exact versions", async () => {
    const run = createNpmResolverRun({
      fetch: packumentFetch({ "1.0.0": {}, "2.0.0": {} }, { next: "2.0.0" }),
    });
    const tagged = await resolveNpmUpdate({
      intent: npmIntent("next", "tag"),
      current: { version: "1.0.0", display: "patcher-plugin-matrix@1.0.0" },
      appVersion: "1.0.0",
      run,
    });
    const exact = await resolveNpmUpdate({
      intent: npmIntent("1.0.0", "exact"),
      current: { version: "1.0.0", display: "patcher-plugin-matrix@1.0.0" },
      appVersion: "1.0.0",
      run,
    });
    expect(tagged).toMatchObject({
      outcome: "update-available",
      candidate: { version: "2.0.0" },
    });
    expect(exact).toEqual({
      outcome: "pinned",
      current: { version: "1.0.0", display: "patcher-plugin-matrix@1.0.0" },
    });
  });
});

/**
 * Real `git init`/`commit`/`tag`, a process apiece. That is fast alone and not
 * fast at all when the rest of the suite is competing for the machine, so the
 * budget has to be about what the work costs rather than what the default
 * assumes — the same reason `test/app/install-machine-script.test.ts` carries
 * its own.
 */
const GIT_TEST_TIMEOUT_MS = 30_000;

describe("git update resolution", () => {
  it("classifies tags and branches, detects a moved branch, and reports current", async () => {
    const repo = await mkdtemp(join(tmpdir(), "patcher-update-resolver-git-"));
    cleanup.push(repo);
    await mkdir(repo, { recursive: true });
    await run("git", ["init", "-q", "-b", "main"], { cwd: repo });
    await run("git", ["config", "user.email", "test@example.com"], {
      cwd: repo,
    });
    await run("git", ["config", "user.name", "Test"], { cwd: repo });
    await writeFile(join(repo, "file.txt"), "one");
    await run("git", ["add", "."], { cwd: repo });
    await run("git", ["commit", "-qm", "one"], { cwd: repo });
    const first = (
      await run("git", ["rev-parse", "HEAD"], { cwd: repo })
    ).stdout.trim();
    await run("git", ["tag", "v1"], { cwd: repo });

    expect(await resolveGitRef({ url: repo, ref: "v1" })).toMatchObject({
      outcome: "resolved",
      refKind: "tag",
      commit: first,
    });
    expect(await resolveGitRef({ url: repo, ref: "main" })).toMatchObject({
      outcome: "resolved",
      refKind: "branch",
      commit: first,
    });
    expect(await resolveGitRef({ url: repo, ref: "HEAD" })).toMatchObject({
      outcome: "resolved",
      refKind: "branch",
      commit: first,
    });
    expect(
      await resolveGitUpdate({
        url: repo,
        ref: "main",
        refKind: "branch",
        currentCommit: first,
      }),
    ).toMatchObject({ outcome: "current" });

    await writeFile(join(repo, "file.txt"), "two");
    await run("git", ["commit", "-qam", "two"], { cwd: repo });
    const second = (
      await run("git", ["rev-parse", "HEAD"], { cwd: repo })
    ).stdout.trim();
    expect(
      await resolveGitUpdate({
        url: repo,
        ref: "main",
        refKind: "branch",
        currentCommit: first,
      }),
    ).toMatchObject({
      outcome: "update-available",
      candidate: { version: second },
    });
    expect(
      await resolveGitUpdate({
        url: repo,
        ref: "v1",
        refKind: "tag",
        currentCommit: first,
      }),
    ).toMatchObject({ outcome: "pinned" });
    expect(
      await resolveGitUpdate({
        url: repo,
        ref: first,
        refKind: "commit",
        currentCommit: first,
      }),
    ).toMatchObject({ outcome: "pinned" });
  }, GIT_TEST_TIMEOUT_MS);
});
