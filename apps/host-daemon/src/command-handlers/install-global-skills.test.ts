import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import fsPromises from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostDaemonSkillTree } from "@patcher/host-daemon-contract";
import {
  installGlobalSkills,
  readGlobalSkillsStatus,
} from "./install-global-skills.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(
    path.join(tmpdir(), "patcher-install-global-skills-"),
  );
  tempDirs.push(dir);
  return dir;
}

function createTree(
  files: readonly { path: string; content: string; mode?: number }[],
): HostDaemonSkillTree {
  const entries = files
    .map((file) => ({
      path: file.path,
      mode: file.mode ?? 0o644,
      contentBase64: Buffer.from(file.content).toString("base64"),
    }))
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
  const hash = createHash("sha256");
  hash.update("patcher-skill-tree-v1");
  for (const entry of entries) {
    const bytes = Buffer.from(entry.contentBase64, "base64");
    hash.update("\0file\0");
    hash.update(entry.path);
    hash.update("\0");
    hash.update(entry.mode.toString(8));
    hash.update("\0");
    hash.update(String(bytes.length));
    hash.update("\0");
    hash.update(bytes);
  }
  return { treeHash: hash.digest("hex"), entries };
}

function createTreePayload(name: string, body: string): HostDaemonSkillTree {
  return createTree([
    {
      path: "SKILL.md",
      content: `---\nname: ${name}\ndescription: Use ${name} outside Patcher.\n---\n\n${body}\n`,
    },
    { path: "references/usage.md", content: `# ${name}\n` },
  ]);
}

function installCommand(
  skills: readonly {
    name: string;
    payload: HostDaemonSkillTree;
    replaceOnlyIfTreeHash?: string;
  }[],
) {
  return {
    type: "host.install_global_skills" as const,
    skills: skills.map((skill) => ({
      name: skill.name,
      treeHash: skill.payload.treeHash,
      entryPath: "SKILL.md",
      ...(skill.replaceOnlyIfTreeHash === undefined
        ? {}
        : { replaceOnlyIfTreeHash: skill.replaceOnlyIfTreeHash }),
    })),
  };
}

function fetchFrom(...payloads: HostDaemonSkillTree[]) {
  return vi.fn(async (treeHash: string) => {
    const payload = payloads.find((entry) => entry.treeHash === treeHash);
    if (payload === undefined) throw new Error(`unknown tree ${treeHash}`);
    return payload;
  });
}

function statusCommand(names: string[] = ["patcher-cli"]) {
  return { type: "host.global_skills_status" as const, names };
}

function copyPaths(homeDir: string, name = "patcher-cli") {
  return {
    agents: path.join(homeDir, ".agents", "skills", name),
    claude: path.join(homeDir, ".claude", "skills", name),
  };
}

describe("install global skills", () => {
  it("writes the skill into both global agent roots", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const payload = createTreePayload("patcher-cli", "first body");

    const result = await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload }]),
      { dataDir, fetchSkillTree: async () => payload, homeDir },
    );

    expect(result.installations).toEqual([
      {
        name: "patcher-cli",
        path: path.join(homeDir, ".agents", "skills", "patcher-cli"),
        outcome: "written",
      },
      {
        name: "patcher-cli",
        path: path.join(homeDir, ".claude", "skills", "patcher-cli"),
        outcome: "written",
      },
    ]);
    for (const installation of result.installations) {
      await expect(
        readFile(path.join(installation.path, "SKILL.md"), "utf8"),
      ).resolves.toContain("first body");
      await expect(
        readFile(
          path.join(installation.path, "references", "usage.md"),
          "utf8",
        ),
      ).resolves.toBe("# patcher-cli\n");
    }
  });

  it("removes the copies installed under the old product name", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const payload = createTreePayload("patcher-cli", "new body");

    // What a machine enrolled before the rename actually carries.
    for (const root of [".agents", ".claude"]) {
      const legacyPath = path.join(homeDir, root, "skills", "bb-cli");
      await mkdir(legacyPath, { recursive: true });
      await writeFile(
        path.join(legacyPath, "SKILL.md"),
        "---\nname: bb-cli\ndescription: Control bb itself from the command line.\n---\n\nRun bb status.\n",
      );
    }
    // Same name, someone else's skill: it does not claim to be ours, so it stays.
    const impostorPath = path.join(
      homeDir,
      ".claude",
      "skills",
      "bb-plugin-authoring",
    );
    await mkdir(impostorPath, { recursive: true });
    await writeFile(
      path.join(impostorPath, "SKILL.md"),
      "---\nname: my-own-notes\n---\n\nMine.\n",
    );

    await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload }]),
      { dataDir, fetchSkillTree: async () => payload, homeDir },
    );

    for (const root of [".agents", ".claude"]) {
      await expect(
        readdir(path.join(homeDir, root, "skills")),
      ).resolves.not.toContain("bb-cli");
    }
    await expect(
      readFile(path.join(impostorPath, "SKILL.md"), "utf8"),
    ).resolves.toContain("my-own-notes");
    await expect(
      readdir(path.join(homeDir, ".claude", "skills")),
    ).resolves.toContain("patcher-cli");
  });

  it("replaces a stale copy without leaving its removed files or staging dirs behind", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const claudeRoot = path.join(homeDir, ".claude", "skills");
    await mkdir(path.join(claudeRoot, "patcher-cli"), { recursive: true });
    await writeFile(
      path.join(claudeRoot, "patcher-cli", "SKILL.md"),
      "stale\n",
    );
    await writeFile(
      path.join(claudeRoot, "patcher-cli", "dropped.md"),
      "gone\n",
    );
    await mkdir(path.join(claudeRoot, "unrelated"), { recursive: true });
    await writeFile(path.join(claudeRoot, "unrelated", "SKILL.md"), "keep\n");
    const payload = createTreePayload("patcher-cli", "fresh body");

    await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload }]),
      { dataDir, fetchSkillTree: async () => payload, homeDir },
    );

    await expect(
      readFile(path.join(claudeRoot, "patcher-cli", "SKILL.md"), "utf8"),
    ).resolves.toContain("fresh body");
    expect(await readdir(path.join(claudeRoot, "patcher-cli"))).toEqual([
      "SKILL.md",
      "references",
    ]);
    expect(await readdir(claudeRoot)).toEqual(["patcher-cli", "unrelated"]);
  });

  it("leaves the installed copy intact when the tree cannot be fetched", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const agentsRoot = path.join(homeDir, ".agents", "skills");
    await mkdir(path.join(agentsRoot, "patcher-cli"), { recursive: true });
    await writeFile(
      path.join(agentsRoot, "patcher-cli", "SKILL.md"),
      "previous\n",
    );
    const payload = createTreePayload("patcher-cli", "never arrives");
    const fetchSkillTree = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(
      installGlobalSkills(installCommand([{ name: "patcher-cli", payload }]), {
        dataDir,
        fetchSkillTree,
        homeDir,
      }),
    ).rejects.toThrow("offline");

    await expect(
      readFile(path.join(agentsRoot, "patcher-cli", "SKILL.md"), "utf8"),
    ).resolves.toBe("previous\n");
  });

  it("reports the installed hash as the tree hash, and detects drift", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const payload = createTreePayload("patcher-cli", "installed body");

    const before = await readGlobalSkillsStatus(statusCommand(), {
      dataDir,
      homeDir,
    });
    expect(before.entries.map((entry) => entry.treeHash)).toEqual([null, null]);

    await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload }]),
      { dataDir, fetchSkillTree: async () => payload, homeDir },
    );

    const after = await readGlobalSkillsStatus(statusCommand(), {
      dataDir,
      homeDir,
    });
    expect(after.entries.map((entry) => entry.treeHash)).toEqual([
      payload.treeHash,
      payload.treeHash,
    ]);

    await writeFile(
      path.join(copyPaths(homeDir).claude, "SKILL.md"),
      "---\nname: patcher-cli\ndescription: Edited by hand.\n---\n",
    );
    const drifted = await readGlobalSkillsStatus(statusCommand(), {
      dataDir,
      homeDir,
    });
    expect(drifted.entries[1]?.treeHash).not.toBe(payload.treeHash);
    expect(drifted.entries[0]?.treeHash).toBe(payload.treeHash);
  });

  // The two sides hash the same tree independently — the server from its
  // built-in directory, the daemon from the copy it wrote — and nothing but
  // agreement makes an installed copy read as current. Nested directories,
  // an executable file and a dotfile are where a copy and a walker could
  // disagree; `.DS_Store` is what Finder adds to a copy nobody changed.
  it("reads a copy back as the tree it installed, whatever the tree holds", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const payload = createTree([
      {
        path: "SKILL.md",
        content: "---\nname: patcher-cli\ndescription: Use it.\n---\n",
      },
      { path: "references/deep/usage.md", content: "# usage\n" },
      { path: "scripts/run.sh", content: "#!/bin/sh\necho hi\n", mode: 0o755 },
      { path: ".notes", content: "dotfile\n" },
    ]);

    await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload }]),
      { dataDir, fetchSkillTree: async () => payload, homeDir },
    );
    await writeFile(path.join(copyPaths(homeDir).agents, ".DS_Store"), "x");
    await writeFile(
      path.join(copyPaths(homeDir).claude, "references", ".DS_Store"),
      "x",
    );

    const status = await readGlobalSkillsStatus(statusCommand(), {
      dataDir,
      homeDir,
    });
    expect(status.entries.map((entry) => entry.treeHash)).toEqual([
      payload.treeHash,
      payload.treeHash,
    ]);
  });
});

describe("what an install records as its own", () => {
  it("records each copy it wrote, and the status read reports it beside the copy", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const payload = createTreePayload("patcher-cli", "body");

    const before = await readGlobalSkillsStatus(statusCommand(), {
      dataDir,
      homeDir,
    });
    expect(before.entries.map((entry) => entry.installedTreeHash)).toEqual([
      null,
      null,
    ]);

    await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload }]),
      { dataDir, fetchSkillTree: fetchFrom(payload), homeDir },
    );

    const after = await readGlobalSkillsStatus(statusCommand(), {
      dataDir,
      homeDir,
    });
    expect(after.entries).toEqual([
      {
        name: "patcher-cli",
        path: copyPaths(homeDir).agents,
        treeHash: payload.treeHash,
        installedTreeHash: payload.treeHash,
      },
      {
        name: "patcher-cli",
        path: copyPaths(homeDir).claude,
        treeHash: payload.treeHash,
        installedTreeHash: payload.treeHash,
      },
    ]);
  });

  it("keeps one data directory's record out of another's, over one home", async () => {
    const releaseDataDir = await makeTempDir();
    const checkoutDataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const payload = createTreePayload("patcher-cli", "release body");

    await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload }]),
      {
        dataDir: releaseDataDir,
        fetchSkillTree: fetchFrom(payload),
        homeDir,
      },
    );

    const checkout = await readGlobalSkillsStatus(statusCommand(), {
      dataDir: checkoutDataDir,
      homeDir,
    });
    expect(checkout.entries.map((entry) => entry.treeHash)).toEqual([
      payload.treeHash,
      payload.treeHash,
    ]);
    expect(checkout.entries.map((entry) => entry.installedTreeHash)).toEqual([
      null,
      null,
    ]);
  });

  it("reads an unreadable record as empty, and the next install writes a good one", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const payload = createTreePayload("patcher-cli", "body");
    await writeFile(
      path.join(dataDir, "global-skills-installed.json"),
      "{not json",
    );

    const corrupt = await readGlobalSkillsStatus(statusCommand(), {
      dataDir,
      homeDir,
    });
    expect(corrupt.entries.map((entry) => entry.installedTreeHash)).toEqual([
      null,
      null,
    ]);

    await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload }]),
      { dataDir, fetchSkillTree: fetchFrom(payload), homeDir },
    );
    const repaired = await readGlobalSkillsStatus(statusCommand(), {
      dataDir,
      homeDir,
    });
    expect(repaired.entries.map((entry) => entry.installedTreeHash)).toEqual([
      payload.treeHash,
      payload.treeHash,
    ]);
  });

  it("keeps both installs in the record when two run at once", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const cli = createTreePayload("patcher-cli", "cli");
    const browser = createTreePayload("patcher-browser", "browser");
    const fetchSkillTree = fetchFrom(cli, browser);

    await Promise.all([
      installGlobalSkills(
        installCommand([{ name: "patcher-cli", payload: cli }]),
        { dataDir, fetchSkillTree, homeDir },
      ),
      installGlobalSkills(
        installCommand([{ name: "patcher-browser", payload: browser }]),
        { dataDir, fetchSkillTree, homeDir },
      ),
    ]);

    const status = await readGlobalSkillsStatus(
      statusCommand(["patcher-cli", "patcher-browser"]),
      { dataDir, homeDir },
    );
    expect(status.entries.map((entry) => entry.installedTreeHash)).toEqual([
      cli.treeHash,
      cli.treeHash,
      browser.treeHash,
      browser.treeHash,
    ]);
  });

  it("records the copies swapped in before an install failed partway", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const cli = createTreePayload("patcher-cli", "cli");
    const browser = createTreePayload("patcher-browser", "browser");

    await expect(
      installGlobalSkills(
        installCommand([
          { name: "patcher-cli", payload: cli },
          { name: "patcher-browser", payload: browser },
        ]),
        { dataDir, fetchSkillTree: fetchFrom(cli), homeDir },
      ),
    ).rejects.toThrow("unknown tree");

    const status = await readGlobalSkillsStatus(
      statusCommand(["patcher-cli", "patcher-browser"]),
      { dataDir, homeDir },
    );
    expect(status.entries.map((entry) => entry.installedTreeHash)).toEqual([
      cli.treeHash,
      cli.treeHash,
      null,
      null,
    ]);
  });
});

describe("a conditional install", () => {
  it("replaces a copy still holding the expected tree and leaves an edited one alone", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const previous = createTreePayload("patcher-cli", "previous");
    const next = createTreePayload("patcher-cli", "next");
    const fetchSkillTree = fetchFrom(previous, next);
    await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload: previous }]),
      { dataDir, fetchSkillTree, homeDir },
    );
    const edited = "---\nname: patcher-cli\ndescription: Mine now.\n---\n";
    await writeFile(path.join(copyPaths(homeDir).claude, "SKILL.md"), edited);

    const result = await installGlobalSkills(
      installCommand([
        {
          name: "patcher-cli",
          payload: next,
          replaceOnlyIfTreeHash: previous.treeHash,
        },
      ]),
      { dataDir, fetchSkillTree, homeDir },
    );

    expect(result.installations.map((entry) => entry.outcome)).toEqual([
      "written",
      "skipped",
    ]);
    await expect(
      readFile(path.join(copyPaths(homeDir).agents, "SKILL.md"), "utf8"),
    ).resolves.toContain("next");
    await expect(
      readFile(path.join(copyPaths(homeDir).claude, "SKILL.md"), "utf8"),
    ).resolves.toBe(edited);
    const status = await readGlobalSkillsStatus(statusCommand(), {
      dataDir,
      homeDir,
    });
    expect(status.entries.map((entry) => entry.installedTreeHash)).toEqual([
      next.treeHash,
      previous.treeHash,
    ]);
  });

  it("does not bring back a copy somebody removed", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const previous = createTreePayload("patcher-cli", "previous");
    const next = createTreePayload("patcher-cli", "next");
    const fetchSkillTree = fetchFrom(previous, next);
    await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload: previous }]),
      { dataDir, fetchSkillTree, homeDir },
    );
    await rm(copyPaths(homeDir).agents, { recursive: true });

    const result = await installGlobalSkills(
      installCommand([
        {
          name: "patcher-cli",
          payload: next,
          replaceOnlyIfTreeHash: previous.treeHash,
        },
      ]),
      { dataDir, fetchSkillTree, homeDir },
    );

    expect(result.installations.map((entry) => entry.outcome)).toEqual([
      "skipped",
      "written",
    ]);
    await expect(
      readdir(path.join(homeDir, ".agents", "skills")),
    ).resolves.toEqual([]);
  });

  it("leaves a copy alone that changed after the check, while the tree was being fetched", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const previous = createTreePayload("patcher-cli", "previous");
    const next = createTreePayload("patcher-cli", "next");
    await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload: previous }]),
      { dataDir, fetchSkillTree: fetchFrom(previous), homeDir },
    );
    const edited = "---\nname: patcher-cli\ndescription: Just now.\n---\n";
    const fetchSkillTree = vi.fn(async () => {
      await writeFile(path.join(copyPaths(homeDir).agents, "SKILL.md"), edited);
      return next;
    });

    const result = await installGlobalSkills(
      installCommand([
        {
          name: "patcher-cli",
          payload: next,
          replaceOnlyIfTreeHash: previous.treeHash,
        },
      ]),
      { dataDir, fetchSkillTree, homeDir },
    );

    expect(fetchSkillTree).toHaveBeenCalledTimes(1);
    expect(result.installations.map((entry) => entry.outcome)).toEqual([
      "skipped",
      "written",
    ]);
    await expect(
      readFile(path.join(copyPaths(homeDir).agents, "SKILL.md"), "utf8"),
    ).resolves.toBe(edited);
    expect(await readdir(path.join(homeDir, ".agents", "skills"))).toEqual([
      "patcher-cli",
    ]);
  });

  it("fetches nothing when no copy still holds the expected tree", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const previous = createTreePayload("patcher-cli", "previous");
    const next = createTreePayload("patcher-cli", "next");
    await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload: previous }]),
      { dataDir, fetchSkillTree: fetchFrom(previous), homeDir },
    );
    await rm(copyPaths(homeDir).agents, { recursive: true });
    await writeFile(
      path.join(copyPaths(homeDir).claude, "SKILL.md"),
      "---\nname: patcher-cli\ndescription: Mine now.\n---\n",
    );
    const fetchSkillTree = fetchFrom(next);

    const result = await installGlobalSkills(
      installCommand([
        {
          name: "patcher-cli",
          payload: next,
          replaceOnlyIfTreeHash: previous.treeHash,
        },
      ]),
      { dataDir, fetchSkillTree, homeDir },
    );

    expect(result.installations.map((entry) => entry.outcome)).toEqual([
      "skipped",
      "skipped",
    ]);
    expect(fetchSkillTree).not.toHaveBeenCalled();
  });

  // Two daemons over one home cannot share a lock, and a swap is a remove and
  // a rename. Losing that race must leave the other install's copy alone and
  // record nothing, rather than claim a copy this install no longer owns.
  it("reports nothing replaced when another install swaps the same copy first", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const previous = createTreePayload("patcher-cli", "previous");
    const next = createTreePayload("patcher-cli", "next");
    const fetchSkillTree = fetchFrom(previous, next);
    await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload: previous }]),
      { dataDir, fetchSkillTree, homeDir },
    );
    // The other install's rename lands between this one's remove and its own
    // rename, so this one's rename finds a copy in the way.
    vi.spyOn(fsPromises, "rm").mockImplementation(async (target, options) => {
      if (String(target) === copyPaths(homeDir).agents) return;
      await rm(target as string, options);
    });

    const result = await installGlobalSkills(
      installCommand([
        {
          name: "patcher-cli",
          payload: next,
          replaceOnlyIfTreeHash: previous.treeHash,
        },
      ]),
      { dataDir, fetchSkillTree, homeDir },
    );

    expect(result.installations[0]?.outcome).toBe("skipped");
    await expect(
      readFile(path.join(copyPaths(homeDir).agents, "SKILL.md"), "utf8"),
    ).resolves.toContain("previous");
    const status = await readGlobalSkillsStatus(statusCommand(), {
      dataDir,
      homeDir,
    });
    expect(status.entries[0]?.installedTreeHash).toBe(previous.treeHash);
  });

  it("records nothing when the copy is not this tree once the swap settles", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const previous = createTreePayload("patcher-cli", "previous");
    const next = createTreePayload("patcher-cli", "next");
    const fetchSkillTree = fetchFrom(previous, next);
    await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload: previous }]),
      { dataDir, fetchSkillTree, homeDir },
    );
    const theirs = "---\nname: patcher-cli\ndescription: Theirs.\n---\n";
    const realRename = fsPromises.rename.bind(fsPromises);
    vi.spyOn(fsPromises, "rename").mockImplementation(async (from, to) => {
      await realRename(from, to);
      if (String(to) === copyPaths(homeDir).agents) {
        await writeFile(path.join(String(to), "SKILL.md"), theirs);
      }
    });

    const result = await installGlobalSkills(
      installCommand([
        {
          name: "patcher-cli",
          payload: next,
          replaceOnlyIfTreeHash: previous.treeHash,
        },
      ]),
      { dataDir, fetchSkillTree, homeDir },
    );

    expect(result.installations[0]?.outcome).toBe("skipped");
    const status = await readGlobalSkillsStatus(statusCommand(), {
      dataDir,
      homeDir,
    });
    expect(status.entries[0]?.installedTreeHash).toBe(previous.treeHash);
  });

  // What the server sends for a machine it is both updating and adopting: one
  // condition per tree, in one command, sharing the tree it fetches once.
  it("takes a write and an adopt for one skill in a single command", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const previous = createTreePayload("patcher-cli", "previous");
    const next = createTreePayload("patcher-cli", "next");
    await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload: previous }]),
      { dataDir, fetchSkillTree: fetchFrom(previous), homeDir },
    );
    const fetchSkillTree = fetchFrom(next);

    const result = await installGlobalSkills(
      {
        type: "host.install_global_skills",
        skills: [
          {
            name: "patcher-cli",
            treeHash: next.treeHash,
            entryPath: "SKILL.md",
            replaceOnlyIfTreeHash: previous.treeHash,
          },
          {
            name: "patcher-cli",
            treeHash: next.treeHash,
            entryPath: "SKILL.md",
            replaceOnlyIfTreeHash: next.treeHash,
          },
        ],
      },
      { dataDir, fetchSkillTree, homeDir },
    );

    // The first condition replaces both copies; the second finds them already
    // at that tree and only records them, without fetching again.
    expect(result.installations.map((entry) => entry.outcome)).toEqual([
      "written",
      "written",
      "adopted",
      "adopted",
    ]);
    expect(fetchSkillTree).toHaveBeenCalledTimes(1);
    const status = await readGlobalSkillsStatus(statusCommand(), {
      dataDir,
      homeDir,
    });
    expect(status.entries.map((entry) => entry.installedTreeHash)).toEqual([
      next.treeHash,
      next.treeHash,
    ]);
  });

  it("adopts a copy that already holds the tree, without fetching or rewriting it", async () => {
    const otherDataDir = await makeTempDir();
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const payload = createTreePayload("patcher-cli", "same bytes");
    await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload }]),
      { dataDir: otherDataDir, fetchSkillTree: fetchFrom(payload), homeDir },
    );
    const before = await stat(path.join(copyPaths(homeDir).agents, "SKILL.md"));
    const fetchSkillTree = fetchFrom(payload);

    const result = await installGlobalSkills(
      installCommand([
        {
          name: "patcher-cli",
          payload,
          replaceOnlyIfTreeHash: payload.treeHash,
        },
      ]),
      { dataDir, fetchSkillTree, homeDir },
    );

    expect(result.installations.map((entry) => entry.outcome)).toEqual([
      "adopted",
      "adopted",
    ]);
    expect(fetchSkillTree).not.toHaveBeenCalled();
    const after = await stat(path.join(copyPaths(homeDir).agents, "SKILL.md"));
    expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
    const status = await readGlobalSkillsStatus(statusCommand(), {
      dataDir,
      homeDir,
    });
    expect(status.entries.map((entry) => entry.installedTreeHash)).toEqual([
      payload.treeHash,
      payload.treeHash,
    ]);
  });

  // The condition names a tree, not a path. Another install at the same version
  // writes the same bytes, so equal bytes in the other root do not make that
  // copy this install's; only its own record does.
  it("leaves alone a copy this install did not record, though it holds the same tree", async () => {
    const dataDir = await makeTempDir();
    const homeDir = await makeTempDir();
    const previous = createTreePayload("patcher-cli", "previous");
    const next = createTreePayload("patcher-cli", "next");
    const fetchSkillTree = fetchFrom(previous, next);
    await installGlobalSkills(
      installCommand([{ name: "patcher-cli", payload: previous }]),
      { dataDir, fetchSkillTree, homeDir },
    );
    await writeFile(
      path.join(dataDir, "global-skills-installed.json"),
      JSON.stringify({
        version: 1,
        copies: { [copyPaths(homeDir).agents]: previous.treeHash },
      }),
    );

    const result = await installGlobalSkills(
      installCommand([
        {
          name: "patcher-cli",
          payload: next,
          replaceOnlyIfTreeHash: previous.treeHash,
        },
      ]),
      { dataDir, fetchSkillTree, homeDir },
    );

    expect(result.installations.map((entry) => entry.outcome)).toEqual([
      "written",
      "skipped",
    ]);
    await expect(
      readFile(path.join(copyPaths(homeDir).claude, "SKILL.md"), "utf8"),
    ).resolves.toContain("previous");
  });
});
