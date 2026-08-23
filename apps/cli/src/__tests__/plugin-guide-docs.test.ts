import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { renderTemplate } from "@patcher/templates";
import { registerPluginCommands } from "../commands/plugin.js";

/**
 * Durability test for the plugins guide chapter (`patcher guide plugins`): every
 * `patcher plugin <subcommand>` and every declared option flag must be mentioned
 * there. Adding a subcommand or flag without documenting it fails here.
 */
function buildPluginCommand(): Command {
  const program = new Command();
  registerPluginCommands(program, () => "http://localhost");
  const plugin = program.commands.find(
    (command) => command.name() === "plugin",
  );
  expect(plugin).toBeDefined();
  return plugin!;
}

describe("plugins guide chapter", () => {
  it("mentions every Patcher plugin subcommand", () => {
    const plugin = buildPluginCommand();
    const names = plugin.commands.map((command) => command.name());
    expect(names.length).toBeGreaterThan(0);

    const guide = renderTemplate("patcherGuidePlugins", {});
    for (const name of names) {
      // Allow pipe-joined forms like "patcher plugin enable|disable <id>".
      const pattern = new RegExp(`patcher plugin (?:[a-z-]+\\|)*${name}\\b`);
      expect(
        guide,
        `"patcher plugin ${name}" is not documented in patcher-guide-plugins.md`,
      ).toMatch(pattern);
    }
  });

  it("mentions every declared patcher plugin option flag", () => {
    const plugin = buildPluginCommand();
    const guide = renderTemplate("patcherGuidePlugins", {});
    let optionCount = 0;
    for (const command of plugin.commands) {
      for (const option of command.options) {
        optionCount += 1;
        // Either spelling counts: the guide's compact usage lines use short
        // forms like "[-n N] [-f]" where the long form would not fit.
        const forms = [option.long, option.short].filter(
          (form): form is string => typeof form === "string",
        );
        expect(forms.length).toBeGreaterThan(0);
        expect(
          forms.some((form) => guide.includes(form)),
          `"patcher plugin ${command.name()}" flag "${option.flags}" is not documented in patcher-guide-plugins.md`,
        ).toBe(true);
      }
    }
    expect(optionCount).toBeGreaterThan(0);
  });
});
