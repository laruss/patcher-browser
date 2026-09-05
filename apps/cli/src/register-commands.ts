import type { Command } from "commander";

import type { ContextSnapshot } from "./context-env.js";
import { registerAgentAccessCommands } from "./commands/agent-access.js";
import { registerEnvironmentCommands } from "./commands/environment.js";
import { registerFileCommands } from "./commands/file.js";
import { registerGuideCommand } from "./commands/guide.js";
import { registerManagerCommands } from "./commands/manager.js";
import { registerMcpServeCommand } from "./commands/mcp-serve.js";
import { registerMachineCommands } from "./commands/machine.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerPluginCommands } from "./commands/plugin.js";
import { registerProviderCommands } from "./commands/provider.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerTerminalCommands } from "./commands/terminal.js";
import { registerSettingsCommands } from "./commands/settings.js";
import { registerSkillCommands } from "./commands/skill.js";
import { registerThemeCommands } from "./commands/theme.js";
import { registerThreadCommands } from "./commands/thread/index.js";
import { registerUpdatesCommands } from "./commands/updates.js";
import { registerVoiceCommands } from "./commands/voice.js";

export interface PatcherCommandDependencies {
  getUrl: () => string;
  getContext: () => ContextSnapshot;
}

/**
 * Every command this CLI has, mounted on a program.
 *
 * Its own function rather than a block in `index.ts` so that a test can hold the
 * same tree the binary has: `mcp-tool-surface.test.ts` asks which commands the
 * MCP tool will run, and an answer drawn from a list of registrations copied by
 * hand would be an answer about the copy.
 */
export function registerPatcherCommands(
  program: Command,
  dependencies: PatcherCommandDependencies,
): void {
  const { getUrl, getContext } = dependencies;
  registerStatusCommand(program, getUrl, getContext);
  registerSettingsCommands(program, getUrl);
  registerAgentAccessCommands(program, getUrl);
  registerProjectCommands(program, getUrl);
  registerProviderCommands(program, getUrl);
  registerManagerCommands(program, getUrl);
  registerMachineCommands(program, getUrl);
  registerUpdatesCommands(program, getUrl);
  registerTerminalCommands(program, getUrl);
  registerThreadCommands(program, getUrl);
  registerEnvironmentCommands(program, getUrl);
  registerFileCommands(program, getUrl);
  registerThemeCommands(program, getUrl);
  registerPluginCommands(program, getUrl);
  registerSkillCommands(program, getUrl, getContext);
  registerGuideCommand(program);
  // Not for people: a turn's provider spawns this to offer the CLI as a tool.
  registerMcpServeCommand(program);
  registerVoiceCommands(program, getUrl);
}
