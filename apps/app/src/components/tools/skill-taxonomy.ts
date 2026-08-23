import type {
  EditableSkillScope,
  SkillScope,
  SkillSummary,
} from "@patcher/server-contract";

export const SKILL_SCOPE_LABELS: Record<SkillScope, string> = {
  "patcher-builtin": "Built-in",
  "patcher-user": "Patcher · user",
  "patcher-project": "Patcher · project",
  "claude-user": "Claude · user",
  "claude-project": "Claude · project",
  "codex-user": "Codex · user",
  "codex-project": "Codex · project",
  "cursor-user": "Cursor · user",
  "cursor-project": "Cursor · project",
  "shared-user": "Shared · user",
  "shared-project": "Shared · project",
  plugin: "Plugin",
};

export function isKnownSkillScope(
  value: string | undefined,
): value is SkillScope {
  return value !== undefined && value in SKILL_SCOPE_LABELS;
}

export function isSkillEditable(
  skill: SkillSummary,
): skill is SkillSummary & { scope: EditableSkillScope } {
  switch (skill.scope) {
    case "patcher-user":
    case "patcher-project":
      return true;
    case "claude-user":
    case "claude-project":
    case "codex-user":
    case "codex-project":
    case "cursor-user":
    case "cursor-project":
      return skill.manageable;
    case "shared-user":
    case "shared-project":
    case "patcher-builtin":
    case "plugin":
      return false;
  }
}
