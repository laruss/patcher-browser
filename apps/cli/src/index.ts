#!/usr/bin/env node
import { Command } from "commander";
import { maybeReexecViaPatcherCli } from "./patcher-cli-reexec.js";
import { registerPatcherCommands } from "./register-commands.js";
import {
  createCliRuntimeContext,
  resolveContextSnapshot,
  resolveServerUrl,
  type CliRuntimeContext,
} from "./context-env.js";
import {
  describeUnreachableServer,
  fetchPluginCliContributions,
  describeUnknownPluginCommand,
  listDisabledPlugins,
  findPluginCliCommand,
  pluginProxyCandidate,
  runPluginCliCommand,
} from "./plugin-cli-proxy.js";
import { resolvePatcherCliVersion } from "./version.js";
import { describeRefusedCredential } from "./app-credential-hint.js";

// Hop to the daemon-managed binary when PATCHER_CLI is set (agent shell env). Must
// run before Commander so flags/help match the intended build.
maybeReexecViaPatcherCli();

const program = new Command();
let cliRuntimeContext: CliRuntimeContext | undefined;

function getCliRuntimeContext(): CliRuntimeContext {
  cliRuntimeContext ??= createCliRuntimeContext();
  return cliRuntimeContext;
}

program
  .name("patcher")
  .description("Patcher CLI - manage your AI coding agents")
  // Program flags (--version/--help) must precede the subcommand; required
  // so `patcher plugin run <id> --flag` passes flags through to the plugin.
  .enablePositionalOptions()
  .version(resolvePatcherCliVersion());

program.addHelpText("after", () => {
  const context = resolveContextSnapshot(getCliRuntimeContext());
  const project = context.projectId ?? "<unset>";
  const thread = context.threadId ?? "<unset>";

  return `

Current context:
  PATCHER_PROJECT_ID: ${project}
  PATCHER_THREAD_ID: ${thread}
  PATCHER_SERVER_URL: ${context.serverUrl}

Quick start:
  patcher status
  patcher project list
  patcher thread show <id>
  patcher thread spawn --project <id> --provider codex --prompt "..."
`;
});

// Helper to get the URL from the program's options
function getUrl(): string {
  return resolveServerUrl(getCliRuntimeContext());
}

function getContext() {
  return resolveContextSnapshot(getCliRuntimeContext());
}

// Register all command groups
registerPatcherCommands(program, { getUrl, getContext });

/**
 * Unknown top-level commands may be plugin-contributed `patcher` subcommands
 * (design §4.4): before letting commander error, ask the server for plugin
 * CLI contributions (short timeout, silent fallback) and proxy on a match.
 * Core commands always win — this only runs for names commander doesn't own.
 */
async function tryPluginCommandProxy(): Promise<void> {
  const knownCommandNames = new Set(
    program.commands.flatMap((command) => [
      command.name(),
      ...command.aliases(),
    ]),
  );
  knownCommandNames.add("help");
  const candidate = pluginProxyCandidate(process.argv[2], knownCommandNames);
  if (candidate === null) return;
  const result = await fetchPluginCliContributions(getUrl());
  if (result.outcome === "unreachable") {
    // The candidate may be a plugin command — only the running server can
    // say which ones exist, so
    // an unreachable server must not degrade into commander's "unknown
    // command".
    console.error(describeUnreachableServer(getUrl(), result.cause));
    process.exit(1);
  }
  if (result.outcome === "unauthorized") {
    // Without this the candidate falls through to commander, which answers
    // "unknown command" — and the command is not unknown, the caller is.
    // The server's own sentence first when it has one: it is the only part
    // that can name *why* — a revoked grant says which grant and that a person
    // revoked it, which nothing on this side could work out.
    const credential = describeRefusedCredential();
    console.error(
      [
        result.serverMessage ??
          `Patcher refused this shell at ${getUrl()} (HTTP 401), so it will not say which commands ${candidate} has.`,
        ...(credential === null ? [] : [credential]),
      ].join("\n"),
    );
    process.exit(1);
  }
  if (result.outcome === "invalid") return;
  const match = findPluginCliCommand(result.contributions, candidate);
  if (match === undefined) {
    // Disabled plugins contribute no commands, so falling through to commander
    // answers "unknown command" for a command that exists and is merely off.
    const advice = describeUnknownPluginCommand(
      candidate,
      await listDisabledPlugins(getUrl()),
    );
    if (advice?.kind === "resolved") {
      // The plugin is named, so this *is* the answer; commander's "unknown
      // command" underneath would only contradict it.
      console.error(advice.message);
      process.exit(1);
    }
    if (advice?.kind === "hint") {
      // A guess, printed and then handed back: commander still owns the error
      // and its "Did you mean …?", which is the right answer for a typo and the
      // common case on any machine with a plugin switched off.
      console.error(advice.message);
    }
    return;
  }
  process.exit(
    await runPluginCliCommand(getUrl(), match.pluginId, process.argv.slice(3)),
  );
}

tryPluginCommandProxy()
  .then(() => program.parseAsync(process.argv))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
