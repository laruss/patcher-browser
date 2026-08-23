import type {
  DiscoveredSkill,
  SkillRootKind,
} from "@patcher/host-daemon-contract";
import { createHash } from "node:crypto";
import type { SkillProvider } from "@patcher/server-contract";
import { describe, expect, it } from "vitest";
import {
  assembleSkillList,
  mapSkillScope,
} from "../../src/services/skills/skill-listing.js";

describe("mapSkillScope", () => {
  const cases: Array<{
    provider: SkillProvider;
    rootKind: SkillRootKind;
    scope: string;
    listedProvider: SkillProvider | null;
    manageable: boolean;
    filePath?: string;
  }> = [
    {
      provider: "claude-code",
      rootKind: "patcher-project",
      scope: "patcher-project",
      listedProvider: null,
      manageable: true,
    },
    {
      provider: "codex",
      rootKind: "patcher-project",
      scope: "patcher-project",
      listedProvider: null,
      manageable: true,
    },
    {
      provider: "claude-code",
      rootKind: "patcher-data-dir",
      scope: "patcher-user",
      listedProvider: null,
      manageable: true,
    },
    {
      provider: "claude-code",
      rootKind: "patcher-builtin",
      scope: "patcher-builtin",
      listedProvider: null,
      manageable: false,
    },
    {
      provider: "claude-code",
      rootKind: "provider-project",
      scope: "claude-project",
      listedProvider: "claude-code",
      manageable: true,
    },
    {
      provider: "claude-code",
      rootKind: "provider-user",
      scope: "claude-user",
      listedProvider: "claude-code",
      manageable: true,
    },
    {
      provider: "codex",
      rootKind: "provider-project",
      scope: "codex-project",
      listedProvider: "codex",
      manageable: true,
    },
    {
      provider: "codex",
      rootKind: "provider-user",
      scope: "codex-user",
      listedProvider: "codex",
      manageable: true,
    },
    {
      provider: "acp-cursor",
      rootKind: "provider-project",
      scope: "cursor-project",
      listedProvider: "acp-cursor",
      manageable: true,
    },
    {
      provider: "acp-cursor",
      rootKind: "provider-user",
      scope: "cursor-user",
      listedProvider: "acp-cursor",
      manageable: true,
    },
    {
      provider: "claude-code",
      rootKind: "plugin",
      scope: "plugin",
      listedProvider: "claude-code",
      manageable: false,
    },
    {
      provider: "codex",
      rootKind: "plugin",
      scope: "plugin",
      listedProvider: "codex",
      manageable: false,
    },
  ];

  for (const testCase of cases) {
    it(`maps (${testCase.provider}, ${testCase.rootKind}) → ${testCase.scope}`, () => {
      expect(
        mapSkillScope(
          testCase.provider,
          testCase.rootKind,
          testCase.filePath ?? "/home/user/skills/review/SKILL.md",
        ),
      ).toEqual({
        scope: testCase.scope,
        provider: testCase.listedProvider,
        manageable: testCase.manageable,
      });
    });
  }

  it("keeps bundled Codex system skills protected", () => {
    expect(
      mapSkillScope(
        "codex",
        "provider-user",
        "/home/user/.codex/skills/.system/imagegen/SKILL.md",
      ),
    ).toEqual({ scope: "codex-user", provider: "codex", manageable: false });
  });
});

describe("assembleSkillList", () => {
  function discovered(
    name: string,
    rootKind: SkillRootKind,
    filePath: string,
  ): DiscoveredSkill {
    return {
      id: `skill_${createHash("sha256").update(filePath).digest("hex")}`,
      name,
      description: null,
      rootKind,
      filePath,
      linked: false,
    };
  }

  it("de-dupes a Patcher skill discovered under both providers", () => {
    const patcher = discovered(
      "shared",
      "patcher-data-dir",
      "/data/skills/shared/SKILL.md",
    );
    const result = assembleSkillList([
      { provider: "claude-code", skills: [patcher] },
      { provider: "codex", skills: [patcher] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "shared",
      provider: null,
      scope: "patcher-user",
    });
  });

  it("keeps provider-specific skills distinct and sorts by scope then name", () => {
    const result = assembleSkillList([
      {
        provider: "claude-code",
        skills: [
          discovered(
            "zed",
            "provider-user",
            "/home/.claude/skills/zed/SKILL.md",
          ),
          discovered(
            "alpha",
            "patcher-project",
            "/cwd/.patcher/skills/alpha/SKILL.md",
          ),
        ],
      },
      {
        provider: "codex",
        skills: [
          discovered(
            "zed",
            "provider-user",
            "/home/.codex/skills/zed/SKILL.md",
          ),
        ],
      },
    ]);
    // patcher-project sorts before claude-user before codex-user; the two `zed` skills are
    // distinct files under different providers.
    expect(result.map((skill) => [skill.scope, skill.name])).toEqual([
      ["patcher-project", "alpha"],
      ["claude-user", "zed"],
      ["codex-user", "zed"],
    ]);
  });

  it("protects a Cursor skill discovered through a symlinked root", () => {
    const cursor = {
      ...discovered(
        "impeccable",
        "provider-project",
        "/cwd/.cursor/skills/impeccable/SKILL.md",
      ),
      linked: true,
    };

    expect(
      assembleSkillList([{ provider: "acp-cursor", skills: [cursor] }]),
    ).toContainEqual(
      expect.objectContaining({
        name: "impeccable",
        scope: "cursor-project",
        provider: "acp-cursor",
        manageable: false,
      }),
    );
  });

  it("keeps linked provider user skills visible but not manageable", () => {
    const linked = {
      ...discovered(
        "shared-link",
        "provider-user",
        "/home/.codex/skills/shared-link/SKILL.md",
      ),
      linked: true,
    };

    expect(
      assembleSkillList([{ provider: "codex", skills: [linked] }])[0],
    ).toMatchObject({
      name: "shared-link",
      scope: "codex-user",
      manageable: false,
    });
  });
});
