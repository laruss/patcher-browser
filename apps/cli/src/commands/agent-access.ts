import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { promisify } from "node:util";
import { PATCHER_AGENT_KEY_ENV } from "@patcher/config/agent-access-key";
import { resolveCliShimPath } from "@patcher/config/cli-shim";
import {
  BROWSER_ACCESS_GRANT_LEVELS,
  browserAccessGrantLevelSchema,
  permissionsForBrowserExternalAccess,
  type BrowserAccessGrantLevel,
} from "@patcher/domain";
import type { SystemBrowserAccessGrant } from "@patcher/server-contract";
import { Command } from "commander";
import { action } from "../action.js";
import { createCliPatcherSdk } from "../client.js";
import { outputJson } from "./helpers.js";

/**
 * Handing an agent outside Patcher a credential for the browser, and taking it
 * back.
 *
 * Its own command group rather than a subcommand of `patcher settings`, because
 * these are not settings. `patcher settings browser-access` answers "how far
 * may an agent holding the app key go", which is a preference about a caller
 * this install cannot name; a grant *is* a caller — a row with a label, a level
 * and a revoke button, whose credential opens two routes.
 *
 * The two are independent on purpose, and the reverse of a ceiling. Making the
 * setting a ceiling over grants would mean opening the browser to every process
 * on the machine before you could open it to one named agent, which is exactly
 * backwards: the recommended shape is the setting left `off` and one grant
 * issued to the agent that needs it.
 */

const execFileAsync = promisify(execFile);

/** How the MCP server is named in the agent's own config. */
const MCP_SERVER_NAME = "patcher-browser";

/**
 * The agents this can configure for you, and the one that means "just tell me".
 *
 * Claude Code and Codex are configured by running *their* `mcp add`, not by
 * editing their config files. Their config is theirs: `~/.claude.json` is
 * rewritten by a running Claude Code, and `~/.codex/config.toml` is a hand-kept
 * file with comments in it that a TOML round-trip would silently reformat. Both
 * ship a command for this, so the safe path is also the short one — and when
 * the binary is not on PATH, the command is printed for the person to run.
 */
const GRANT_TARGETS = ["shell", "claude-code", "codex"] as const;
type GrantTarget = (typeof GRANT_TARGETS)[number];

interface GrantOptions {
  level?: string;
  for?: string;
  json?: boolean;
}

function parseLevel(value: string | undefined): BrowserAccessGrantLevel {
  if (value === undefined) return "read";
  const parsed = browserAccessGrantLevelSchema.safeParse(value);
  if (!parsed.success) {
    // Named rather than "invalid": the levels are a ramp, and a caller that
    // guessed "all" or "write" needs to see the three words.
    throw new Error(
      `Unknown level '${value}'. One of: ${BROWSER_ACCESS_GRANT_LEVELS.join(", ")}.`,
    );
  }
  return parsed.data;
}

function parseTarget(value: string | undefined): GrantTarget {
  if (value === undefined) return "shell";
  const target = GRANT_TARGETS.find((entry) => entry === value);
  if (target === undefined) {
    throw new Error(
      `Unknown target '${value}'. One of: ${GRANT_TARGETS.join(", ")}.`,
    );
  }
  return target;
}

function formatWhen(at: number | null): string {
  return at === null ? "never" : new Date(at).toISOString();
}

/**
 * How to spawn this CLI as an MCP server, for an agent's config.
 *
 * The shim first, because it is a stable absolute path that survives an upgrade
 * — `<dataDir>/bin/patcher`, written by the daemon at startup — and an agent's
 * config outlives any particular build directory. It carries this install's
 * server URL too, so a config written from it keeps working if the port moves.
 * Falling back to this process's own entry point means a checkout with no
 * daemon started yet still gets a working line, pinned to that checkout.
 */
async function resolveMcpServerCommand(
  dataDir: string,
): Promise<{ command: string; args: string[] }> {
  const shim = resolveCliShimPath(dataDir);
  try {
    await access(shim, constants.X_OK);
    return { command: shim, args: ["mcp-serve"] };
  } catch {
    const selfEntry = process.argv[1];
    return selfEntry === undefined
      ? { command: "patcher", args: ["mcp-serve"] }
      : { command: process.execPath, args: [selfEntry, "mcp-serve"] };
  }
}

interface McpInstallPlan {
  /** The binary whose own command writes its own config. */
  agentBinary: string;
  /** Its argv, ready to run and ready to print. */
  argv: string[];
  /** What undoes it, printed either way. */
  undo: string;
}

function buildMcpInstallPlan(
  target: Exclude<GrantTarget, "shell">,
  server: { command: string; args: string[] },
  env: { serverUrl: string; key: string },
): McpInstallPlan {
  const envPairs = [
    `${PATCHER_AGENT_KEY_ENV}=${env.key}`,
    `PATCHER_SERVER_URL=${env.serverUrl}`,
  ];
  if (target === "claude-code") {
    return {
      agentBinary: "claude",
      argv: [
        "mcp",
        "add",
        "--scope",
        "user",
        MCP_SERVER_NAME,
        ...envPairs.flatMap((pair) => ["-e", pair]),
        "--",
        server.command,
        ...server.args,
      ],
      undo: `claude mcp remove --scope user ${MCP_SERVER_NAME}`,
    };
  }
  return {
    agentBinary: "codex",
    argv: [
      "mcp",
      "add",
      MCP_SERVER_NAME,
      ...envPairs.flatMap((pair) => ["--env", pair]),
      "--",
      server.command,
      ...server.args,
    ],
    undo: `codex mcp remove ${MCP_SERVER_NAME}`,
  };
}

/** A shell-safe rendering of a command, for printing rather than for running. */
function quoteArgv(binary: string, argv: readonly string[]): string {
  return [binary, ...argv]
    .map((part) =>
      /^[A-Za-z0-9_@%+=:,./-]+$/u.test(part)
        ? part
        : `'${part.replace(/'/gu, `'\\''`)}'`,
    )
    .join(" ");
}

function printShellDelivery(serverUrl: string, key: string): void {
  console.log("");
  console.log("Give the agent these two, and nothing else:");
  console.log(`  export PATCHER_SERVER_URL='${serverUrl}'`);
  console.log(`  export ${PATCHER_AGENT_KEY_ENV}='${key}'`);
  console.log(
    "In a shell with those, `patcher browser` works and the rest of `patcher` is refused.",
  );
}

async function runMcpInstall(plan: McpInstallPlan): Promise<void> {
  const printed = quoteArgv(plan.agentBinary, plan.argv);
  try {
    await execFileAsync(plan.agentBinary, plan.argv);
  } catch (error) {
    // Its binary is not on this PATH, or it refused. Either way the command is
    // the useful thing to hand back: this never edits their config itself, so
    // there is nothing half-done to undo.
    console.log("");
    console.log(
      `Could not run \`${plan.agentBinary} mcp add\` (${error instanceof Error ? error.message.split("\n")[0] : String(error)}).`,
    );
    console.log("Run this yourself, in a shell where that binary is on PATH:");
    console.log(`  ${printed}`);
    return;
  }
  console.log("");
  console.log(`Added the \`${MCP_SERVER_NAME}\` MCP server:`);
  console.log(`  ${printed}`);
  console.log(`Undo it with \`${plan.undo}\`.`);
}

function printGrantTable(grants: readonly SystemBrowserAccessGrant[]): void {
  if (grants.length === 0) {
    console.log(
      "No browser access grants. `patcher agent-access grant <label>` issues one.",
    );
    return;
  }
  for (const grant of grants) {
    const state =
      grant.revokedAt === null
        ? `last used ${formatWhen(grant.lastUsedAt)}`
        : `revoked ${formatWhen(grant.revokedAt)}`;
    console.log(`${grant.id}  ${grant.level.padEnd(8)} ${grant.label}`);
    console.log(`  issued ${formatWhen(grant.createdAt)}, ${state}`);
  }
}

export function registerAgentAccessCommands(
  program: Command,
  getUrl: () => string,
): void {
  const agentAccess = program
    .command("agent-access")
    .description(
      "Credentials that let one agent outside Patcher drive the browser",
    );

  agentAccess
    .command("list")
    .description("Every browser access grant, live and revoked")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: { json?: boolean }) => {
        const sdk = createCliPatcherSdk(getUrl());
        const result = await sdk.system.browserAccessGrants();
        if (outputJson(opts, result)) return;
        printGrantTable(result.grants);
      }),
    );

  agentAccess
    .command("grant <label>")
    .description(
      `Issue a credential for one agent. Levels: ${BROWSER_ACCESS_GRANT_LEVELS.join(" | ")}`,
    )
    .option(
      "--level <level>",
      `How far it reaches: ${BROWSER_ACCESS_GRANT_LEVELS.join(" | ")}`,
      "read",
    )
    .option(
      "--for <target>",
      `Who it is for: ${GRANT_TARGETS.join(" | ")}. Anything but 'shell' writes that agent's own MCP config, through its own command`,
      "shell",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (label: string, opts: GrantOptions) => {
        const level = parseLevel(opts.level);
        const target = parseTarget(opts.for);
        const sdk = createCliPatcherSdk(getUrl());
        const result = await sdk.system.createBrowserAccessGrant({
          label,
          level,
        });
        if (outputJson(opts, result)) return;
        console.log(
          `Issued "${result.grant.label}" (${result.grant.id}) at level ${level}: ${permissionsForBrowserExternalAccess(level).join(", ")}.`,
        );
        if (!result.browserToolsEnabled) {
          // The route turns the plugin on, so reaching here means it could not
          // load — and a credential for a command nothing serves would
          // otherwise look like a broken grant rather than a broken plugin.
          console.log(
            "The browser-tools plugin is not serving `patcher browser`, so nothing can use this grant yet. Check `patcher plugin list`.",
          );
        }
        const config = await sdk.system.config();
        if (target === "shell") {
          printShellDelivery(config.serverUrl, result.key);
        } else {
          await runMcpInstall(
            buildMcpInstallPlan(
              target,
              await resolveMcpServerCommand(config.dataDir),
              { serverUrl: config.serverUrl, key: result.key },
            ),
          );
        }
        console.log("");
        console.log(
          `Take it back with \`patcher agent-access revoke ${result.grant.id}\`, or in Settings → General → Agents outside Patcher.`,
        );
      }),
    );

  agentAccess
    .command("revoke <id>")
    .description("Stop a grant. The next request presenting it is refused")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: { json?: boolean }) => {
        const sdk = createCliPatcherSdk(getUrl());
        const result = await sdk.system.revokeBrowserAccessGrant(id);
        if (outputJson(opts, result)) return;
        console.log(`Revoked ${id}.`);
        printGrantTable(result.grants);
      }),
    );
}
