import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBuiltinSkillsRootPath } from "../../src/services/skills/builtin-skills-copy.js";

/**
 * Structural guard for every built-in skill: SKILL.md is loaded in full the
 * moment the skill triggers, so it has to stay small and route to
 * references/*.md for the detail. Agent Skills recommends keeping SKILL.md
 * under 500 lines.
 *
 * A reference file the entry never names is unreachable — progressive
 * disclosure only works when SKILL.md says which file to read — and a link to
 * a file that does not exist sends the agent looking for nothing. Both fail
 * here rather than in a thread.
 *
 * Frontmatter validity of the shipped tree is covered by
 * injected-skills.test.ts, which asserts the built-in root resolves without
 * skipping a skill.
 */

const SKILL_MAX_LINES = 500;
const REFERENCE_LINK_PATTERN = /references\/[A-Za-z0-9._-]+\.md/g;

const builtinSkillsRootPath = resolveBuiltinSkillsRootPath();

function readSkillNames(): string[] {
  return readdirSync(builtinSkillsRootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readReferenceFileNames(skillName: string): string[] {
  const referencesPath = path.join(
    builtinSkillsRootPath,
    skillName,
    "references",
  );
  try {
    if (!statSync(referencesPath).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }
  return readdirSync(referencesPath)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

const skillNames = readSkillNames();

describe("built-in skill structure", () => {
  it("ships at least the skills the server depends on", () => {
    expect(skillNames).toContain("patcher-cli");
  });

  describe.each(skillNames)("%s", (skillName) => {
    const skillDir = path.join(builtinSkillsRootPath, skillName);
    const entry = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    const referenceFileNames = readReferenceFileNames(skillName);

    it("keeps SKILL.md within the progressive-disclosure budget", () => {
      const lineCount = entry.split("\n").length;
      expect(
        lineCount,
        `${skillName}/SKILL.md is ${lineCount} lines; move detail into references/`,
      ).toBeLessThanOrEqual(SKILL_MAX_LINES);
    });

    it("routes to every reference file it ships", () => {
      for (const name of referenceFileNames) {
        expect(
          entry,
          `${skillName}/references/${name} is not linked from SKILL.md, so the agent cannot find it`,
        ).toContain(`references/${name}`);
      }
    });

    it("only links reference files that exist", () => {
      const linked = new Set(entry.match(REFERENCE_LINK_PATTERN) ?? []);
      for (const link of linked) {
        expect(
          referenceFileNames,
          `${skillName}/SKILL.md links ${link}, which does not exist`,
        ).toContain(path.basename(link));
      }
    });
  });
});
