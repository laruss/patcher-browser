import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import type { HostDaemonOnlineRpcResult } from "@patcher/host-daemon-contract";
import {
  CommandDispatchError,
  type CommandOf,
} from "../command-dispatch-support.js";
import {
  copyInjectedSkillSource,
  ensureStoredSkillTree,
  hashInstalledSkillDirectory,
} from "../injected-skills.js";
import type { FetchSkillTree } from "../skill-trees.js";

/**
 * Global skill roots read by agents running outside Patcher. `~/.agents/skills` is
 * the cross-agent convention; `~/.claude/skills` is Claude Code's user root.
 */
const GLOBAL_SKILL_ROOT_SEGMENTS: readonly (readonly string[])[] = [
  [".agents", "skills"],
  [".claude", "skills"],
];

/**
 * Global skill directories this product installed under its old name.
 *
 * These roots are outside the Patcher data directory, so the `~/.bb` → `~/.patcher`
 * clean break never reached them: after the rename, `~/.claude/skills/bb-cli`
 * survives beside the freshly installed `patcher-cli`, still declaring
 * `description: Control bb itself from the command line…`. Claude Code loads
 * both, triggers the old one on exactly the tasks the new one targets, and then
 * tells the agent to run `bb status` — a binary this fork no longer ships. Two
 * near-identical skills, one actively wrong.
 *
 * Names, not a pattern: this is the user's own skill root and holds skills from
 * other sources. Each candidate also has to declare the legacy name in its own
 * frontmatter before it is removed, so a directory that merely collides with
 * one of these is left where it is.
 */
const RENAMED_GLOBAL_SKILL_NAMES: readonly string[] = [
  "bb-cli",
  "bb-plugin-authoring",
];

export interface InstallGlobalSkillsOptions {
  dataDir: string;
  fetchSkillTree?: FetchSkillTree;
  homeDir?: string;
}

export interface GlobalSkillsStatusOptions {
  /** Defaults to this host's home directory; injected by tests. */
  homeDir?: string;
}

function globalSkillPaths(homeDir: string, name: string): string[] {
  return GLOBAL_SKILL_ROOT_SEGMENTS.map((segments) =>
    path.join(homeDir, ...segments, name),
  );
}

/** The name a skill directory claims for itself, or null if it claims none. */
async function readDeclaredSkillName(
  skillDirectoryPath: string,
): Promise<string | null> {
  let content: string;
  try {
    content = await fs.readFile(
      path.join(skillDirectoryPath, "SKILL.md"),
      "utf8",
    );
  } catch {
    return null;
  }
  try {
    const name: unknown = matter(content).data.name;
    return typeof name === "string" && name.trim().length > 0
      ? name.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * Remove the copies this product installed under its old name. Runs on every
 * install rather than once, because there is no uninstall RPC and no record of
 * which machines still carry them — an install is the only moment the daemon is
 * known to be reachable and the roots are known to be writable.
 */
export async function pruneRenamedGlobalSkills(args: {
  homeDir: string;
}): Promise<{ name: string; path: string }[]> {
  const removed: { name: string; path: string }[] = [];
  for (const name of RENAMED_GLOBAL_SKILL_NAMES) {
    for (const skillDirectoryPath of globalSkillPaths(args.homeDir, name)) {
      if ((await readDeclaredSkillName(skillDirectoryPath)) !== name) {
        continue;
      }
      await fs.rm(skillDirectoryPath, { force: true, recursive: true });
      removed.push({ name, path: skillDirectoryPath });
    }
  }
  return removed;
}

/**
 * Report the content hash of each installed copy in the global skill roots. The
 * server compares these against the tree hashes it would install to decide
 * whether a machine is up to date.
 */
export async function readGlobalSkillsStatus(
  command: CommandOf<"host.global_skills_status">,
  options: GlobalSkillsStatusOptions,
): Promise<HostDaemonOnlineRpcResult<"host.global_skills_status">> {
  const homeDir = options.homeDir ?? os.homedir();
  const entries = await Promise.all(
    command.names.flatMap((name) =>
      globalSkillPaths(homeDir, name).map(async (skillDirectoryPath) => ({
        name,
        path: skillDirectoryPath,
        treeHash: await hashInstalledSkillDirectory({
          name,
          skillDirectoryPath,
        }),
      })),
    ),
  );
  return { entries };
}

/**
 * Materialize the tree beside its destination and swap it in, so a failed copy
 * never leaves a half-written skill where an agent would read it. The previous
 * copy is removed only once the replacement is fully staged.
 */
async function replaceSkillDirectory(args: {
  destinationPath: string;
  name: string;
  skillFilePath: string;
  sourceRootPath: string;
}): Promise<void> {
  const parentPath = path.dirname(args.destinationPath);
  await fs.mkdir(parentPath, { recursive: true });
  const stagingPath = path.join(
    parentPath,
    `.patcher-tmp-${args.name}-${process.pid}-${randomUUID()}`,
  );
  try {
    await copyInjectedSkillSource({
      destinationPath: stagingPath,
      name: args.name,
      skillFilePath: args.skillFilePath,
      sourceRootPath: args.sourceRootPath,
    });
    await fs.rm(args.destinationPath, { force: true, recursive: true });
    await fs.rename(stagingPath, args.destinationPath);
  } finally {
    await fs.rm(stagingPath, { force: true, recursive: true });
  }
}

/**
 * Install server-owned skill trees into every global agent skill root on this
 * host. Existing copies of the same skill name are replaced; unrelated skills
 * in those roots are untouched.
 */
export async function installGlobalSkills(
  command: CommandOf<"host.install_global_skills">,
  options: InstallGlobalSkillsOptions,
): Promise<HostDaemonOnlineRpcResult<"host.install_global_skills">> {
  const { fetchSkillTree } = options;
  if (fetchSkillTree === undefined) {
    throw new CommandDispatchError(
      "skill_tree_transport_unavailable",
      "Skill tree fetch transport is unavailable",
    );
  }
  const homeDir = options.homeDir ?? os.homedir();
  const installations: { name: string; path: string }[] = [];

  for (const skill of command.skills) {
    const sourceRootPath = await ensureStoredSkillTree({
      dataDir: options.dataDir,
      fetchSkillTree,
      treeHash: skill.treeHash,
    });
    const skillFilePath = path.resolve(sourceRootPath, skill.entryPath);
    if (
      path.relative(sourceRootPath, skillFilePath).startsWith("..") ||
      path.isAbsolute(path.relative(sourceRootPath, skillFilePath))
    ) {
      throw new CommandDispatchError(
        "invalid_path",
        `Skill entry path escapes its tree: ${skill.entryPath}`,
      );
    }
    for (const destinationPath of globalSkillPaths(homeDir, skill.name)) {
      await replaceSkillDirectory({
        destinationPath,
        name: skill.name,
        skillFilePath,
        sourceRootPath,
      });
      installations.push({ name: skill.name, path: destinationPath });
    }
  }

  // After the installs, so a machine that fails partway through still has the
  // old copies to fall back on rather than neither.
  await pruneRenamedGlobalSkills({ homeDir });

  return { installations };
}
