import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import type {
  HostDaemonOnlineRpcResult,
  HostInstallGlobalSkill,
} from "@patcher/host-daemon-contract";
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

/**
 * What this data directory installed into the global skill roots, by absolute
 * copy path: the tree hash it wrote there. It is how a copy this install put in
 * place and nobody changed since is told apart from one a person edited or
 * another install on the same home wrote (#142) — a release and a source
 * checkout share `~/.claude/skills` but never a data directory.
 */
const INSTALL_RECORD_FILE_NAME = "global-skills-installed.json";

const TREE_HASH_PATTERN = /^[a-f0-9]{64}$/u;

const installRecordSchema = z.object({
  version: z.literal(1),
  copies: z.record(z.string(), z.string().regex(TREE_HASH_PATTERN)),
});

export interface InstallGlobalSkillsOptions {
  dataDir: string;
  fetchSkillTree?: FetchSkillTree;
  homeDir?: string;
}

export interface GlobalSkillsStatusOptions {
  dataDir: string;
  /** Defaults to this host's home directory; injected by tests. */
  homeDir?: string;
}

type InstallOutcome =
  HostDaemonOnlineRpcResult<"host.install_global_skills">["installations"][number]["outcome"];

function globalSkillPaths(homeDir: string, name: string): string[] {
  return GLOBAL_SKILL_ROOT_SEGMENTS.map((segments) =>
    path.join(homeDir, ...segments, name),
  );
}

/**
 * An unreadable record — never written, corrupted, or from a later format —
 * reads as empty: nothing counts as this install's, so nothing is replaced
 * without being asked, and the next Install writes a fresh one.
 */
async function readInstallRecord(
  dataDir: string,
): Promise<Map<string, string>> {
  try {
    const parsed = installRecordSchema.safeParse(
      JSON.parse(
        await fs.readFile(path.join(dataDir, INSTALL_RECORD_FILE_NAME), "utf8"),
      ),
    );
    return new Map(parsed.success ? Object.entries(parsed.data.copies) : []);
  } catch {
    return new Map();
  }
}

async function writeInstallRecord(
  dataDir: string,
  copies: ReadonlyMap<string, string>,
): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  const recordPath = path.join(dataDir, INSTALL_RECORD_FILE_NAME);
  const stagingPath = `${recordPath}.${process.pid}-${randomUUID()}.tmp`;
  try {
    await fs.writeFile(
      stagingPath,
      `${JSON.stringify({ version: 1, copies: Object.fromEntries(copies) }, null, 2)}\n`,
    );
    await fs.rename(stagingPath, recordPath);
  } finally {
    await fs.rm(stagingPath, { force: true });
  }
}

const installTailByDataDir = new Map<string, Promise<unknown>>();

/**
 * One install at a time per data directory. The record is read, changed and
 * written back, and a conditional replace checks a copy before swapping it, so
 * two installs interleaving inside one daemon — a person's Install landing
 * during a connect-time update — could otherwise lose a record entry or
 * replace a copy the other just wrote.
 */
function runExclusively<T>(
  dataDir: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = installTailByDataDir.get(dataDir) ?? Promise.resolve();
  const run = previous.then(task);
  const tail = run.catch(() => undefined);
  installTailByDataDir.set(dataDir, tail);
  void tail.then(() => {
    if (installTailByDataDir.get(dataDir) === tail) {
      installTailByDataDir.delete(dataDir);
    }
  });
  return run;
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
 * Report the content hash of each installed copy in the global skill roots,
 * beside the hash this data directory last installed there. The server compares
 * these against the tree hashes it would install to decide whether a machine is
 * up to date, and whether an out-of-date copy is still this install's to update.
 */
export async function readGlobalSkillsStatus(
  command: CommandOf<"host.global_skills_status">,
  options: GlobalSkillsStatusOptions,
): Promise<HostDaemonOnlineRpcResult<"host.global_skills_status">> {
  const homeDir = options.homeDir ?? os.homedir();
  const record = await readInstallRecord(options.dataDir);
  const entries = await Promise.all(
    command.names.flatMap((name) =>
      globalSkillPaths(homeDir, name).map(async (skillDirectoryPath) => ({
        name,
        path: skillDirectoryPath,
        treeHash: await hashInstalledSkillDirectory({
          name,
          skillDirectoryPath,
        }),
        installedTreeHash: record.get(skillDirectoryPath) ?? null,
      })),
    ),
  );
  return { entries };
}

/**
 * Materialize the tree beside its destination and swap it in, so a failed copy
 * never leaves a half-written skill where an agent would read it. The previous
 * copy is removed only once the replacement is fully staged.
 *
 * With `replaceOnlyIfTreeHash`, the copy is hashed again after staging, right
 * before it would be removed, so the window in which a change can slip past the
 * check does not include the copy itself. Returns whether it replaced anything.
 */
async function replaceSkillDirectory(args: {
  destinationPath: string;
  name: string;
  replaceOnlyIfTreeHash: string | undefined;
  skillFilePath: string;
  sourceRootPath: string;
}): Promise<boolean> {
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
    if (
      args.replaceOnlyIfTreeHash !== undefined &&
      (await hashInstalledSkillDirectory({
        name: args.name,
        skillDirectoryPath: args.destinationPath,
      })) !== args.replaceOnlyIfTreeHash
    ) {
      return false;
    }
    await fs.rm(args.destinationPath, { force: true, recursive: true });
    await fs.rename(stagingPath, args.destinationPath);
    return true;
  } finally {
    await fs.rm(stagingPath, { force: true, recursive: true });
  }
}

/**
 * What a conditional install does with one copy, decided before the tree is
 * fetched so a skill with nothing to write costs no transfer.
 *
 * The condition names a tree, not a path — no path crosses the wire — so the
 * record decides per copy which ones it covers: a copy is replaced only where
 * this data directory recorded that tree. The other root can hold the same
 * bytes without being this install's (another install at the same version),
 * and that copy stays as it is. Adopting writes nothing, so a copy already
 * holding the new tree is recorded whoever put it there.
 */
async function planCopy(args: {
  destinationPath: string;
  record: ReadonlyMap<string, string>;
  skill: HostInstallGlobalSkill;
}): Promise<"write" | "adopt" | "skip"> {
  const { destinationPath, record, skill } = args;
  if (skill.replaceOnlyIfTreeHash === undefined) return "write";
  const onDisk = await hashInstalledSkillDirectory({
    name: skill.name,
    skillDirectoryPath: destinationPath,
  });
  if (onDisk !== skill.replaceOnlyIfTreeHash) return "skip";
  if (onDisk === skill.treeHash) return "adopt";
  return record.get(destinationPath) === onDisk ? "write" : "skip";
}

async function resolveSkillFilePath(args: {
  dataDir: string;
  fetchSkillTree: FetchSkillTree;
  skill: HostInstallGlobalSkill;
}): Promise<{ skillFilePath: string; sourceRootPath: string }> {
  const sourceRootPath = await ensureStoredSkillTree({
    dataDir: args.dataDir,
    fetchSkillTree: args.fetchSkillTree,
    treeHash: args.skill.treeHash,
  });
  const skillFilePath = path.resolve(sourceRootPath, args.skill.entryPath);
  if (
    path.relative(sourceRootPath, skillFilePath).startsWith("..") ||
    path.isAbsolute(path.relative(sourceRootPath, skillFilePath))
  ) {
    throw new CommandDispatchError(
      "invalid_path",
      `Skill entry path escapes its tree: ${args.skill.entryPath}`,
    );
  }
  return { skillFilePath, sourceRootPath };
}

/**
 * Install server-owned skill trees into every global agent skill root on this
 * host. Existing copies of the same skill name are replaced — or, for a skill
 * with `replaceOnlyIfTreeHash`, only those this data directory recorded as that
 * tree and that still hold it; unrelated skills in those roots are untouched. Every copy written or adopted is
 * recorded as this data directory's.
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

  return runExclusively(options.dataDir, async () => {
    const record = await readInstallRecord(options.dataDir);
    let recordChanged = false;
    const installations: {
      name: string;
      outcome: InstallOutcome;
      path: string;
    }[] = [];

    try {
      for (const skill of command.skills) {
        const copies = await Promise.all(
          globalSkillPaths(homeDir, skill.name).map(
            async (destinationPath) => ({
              destinationPath,
              plan: await planCopy({ destinationPath, record, skill }),
            }),
          ),
        );
        const source = copies.some((copy) => copy.plan === "write")
          ? await resolveSkillFilePath({
              dataDir: options.dataDir,
              fetchSkillTree,
              skill,
            })
          : null;
        for (const { destinationPath, plan } of copies) {
          let outcome: InstallOutcome = "skipped";
          if (plan === "adopt") {
            outcome = "adopted";
          } else if (plan === "write" && source !== null) {
            const replaced = await replaceSkillDirectory({
              destinationPath,
              name: skill.name,
              replaceOnlyIfTreeHash: skill.replaceOnlyIfTreeHash,
              ...source,
            });
            outcome = replaced ? "written" : "skipped";
          }
          if (outcome !== "skipped") {
            record.set(destinationPath, skill.treeHash);
            recordChanged = true;
          }
          installations.push({
            name: skill.name,
            path: destinationPath,
            outcome,
          });
        }
      }

      // After the installs, so a machine that fails partway through still has
      // the old copies to fall back on rather than neither.
      await pruneRenamedGlobalSkills({ homeDir });
    } finally {
      // Also after a failure partway: the copies already swapped in are this
      // install's, and an unrecorded one would never be updated again.
      if (recordChanged) {
        await writeInstallRecord(options.dataDir, record);
      }
    }

    return { installations };
  });
}
