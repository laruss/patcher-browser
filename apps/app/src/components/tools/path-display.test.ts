import { describe, expect, it } from "vitest";
import { formatHomePathForDisplay } from "@patcher/shared-ui/lib/utils";

describe("formatHomePathForDisplay", () => {
  it.each([
    ["/Users/you", "~"],
    ["/Users/you/.patcher/plugins/github", "~/.patcher/plugins/github"],
    ["/home/u/.patcher/skills/review", "~/.patcher/skills/review"],
    ["/root/.patcher/automations/run.sh", "~/.patcher/automations/run.sh"],
    ["C:\\Users\\you\\.patcher\\plugins", "~\\.patcher\\plugins"],
  ])("compacts a conventional home path %s", (path, expected) => {
    expect(formatHomePathForDisplay(path)).toBe(expected);
  });

  it.each([
    "/managed/plugins/github",
    "/Volumes/work/plugins/github",
    "skills.sh/example/writing-voice",
    "SKILL.md",
  ])("preserves a path outside a conventional home %s", (path) => {
    expect(formatHomePathForDisplay(path)).toBe(path);
  });
});
