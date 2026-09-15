import { execFile } from "node:child_process";
import { access, constants, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  PATCHER_AGENT_KEY_ENV,
  PATCHER_AGENT_KEY_FILE_ENV,
} from "@patcher/config/agent-access-key";
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
 * Where a grant's key is written, under the data dir, one file per grant.
 *
 * Written rather than printed (#134). Printed, the key goes wherever that
 * terminal's output goes — and when an agent ran the command, that is its
 * transcript and its session log. The file is `0600`, beside the app key the
 * server keeps in the same directory, so it is readable by exactly the
 * processes that could already read that; an agent's config holding the key
 * itself was the same exposure, and a transcript is a wider one.
 */
const AGENT_KEY_DIR_NAME = "agent-keys";

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
  printKey?: boolean;
}

function parseLevel(value: string | undefined): BrowserAccessGrantLevel {
  if (value === undefined) return "read";
  const parsed = browserAccessGrantLevelSchema.safeParse(value);
  if (!parsed.success) {
    // Named rather than "invalid": the levels are a ramp, and a caller that
    // guessed "all" or "write" needs to see the words themselves.
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
  /** What a person calls it, for the step after. */
  agentName: string;
  /** Its argv, ready to run and ready to print. */
  argv: string[];
  /** What undoes it, printed either way. */
  undo: string;
}

function buildMcpInstallPlan(
  target: Exclude<GrantTarget, "shell">,
  server: { command: string; args: string[] },
  env: { serverUrl: string; keyFile: string },
): McpInstallPlan {
  // The key's file rather than the key (#134): this argv is printed, it is
  // visible in `ps` while the command runs, and it lands in a config file that
  // belongs to somebody else's program. A path is a secret in none of those.
  const envPairs = [
    `${PATCHER_AGENT_KEY_FILE_ENV}=${env.keyFile}`,
    `PATCHER_SERVER_URL=${env.serverUrl}`,
  ];
  if (target === "claude-code") {
    return {
      agentBinary: "claude",
      agentName: "Claude Code",
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
    agentName: "Codex",
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

/** One shell word, quoted only when it needs it. */
function quoteWord(part: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/u.test(part)
    ? part
    : `'${part.replace(/'/gu, `'\\''`)}'`;
}

/** A shell-safe rendering of a command, for printing rather than for running. */
function quoteArgv(binary: string, argv: readonly string[]): string {
  return [binary, ...argv].map(quoteWord).join(" ");
}

/**
 * What to hand an agent in a shell: the key's file, and a Patcher it can run.
 *
 * `patcher` is usually not on PATH, so the command is named whole: the shim
 * when this install has one, or this CLI's own entry point when it does not —
 * the same fallback its MCP config would get. The shim exports the server URL
 * itself (`cli-shim.ts`), so an agent calling it needs the key and nothing
 * else, which this used to leave unsaid while asking for both variables.
 */
function printShellDelivery(args: {
  serverUrl: string;
  keyFile: string;
  invocation: string;
  viaShim: boolean;
}): void {
  const keyLine = `  export ${PATCHER_AGENT_KEY_FILE_ENV}=${quoteWord(args.keyFile)}`;
  const urlExport = `export PATCHER_SERVER_URL=${quoteWord(args.serverUrl)}`;
  console.log("");
  if (args.viaShim) {
    console.log("Give the agent this, and nothing else:");
    console.log(keyLine);
    console.log(
      `and have it run Patcher as ${args.invocation}, which already points at this install's server. A \`patcher\` from anywhere else needs \`${urlExport}\` as well.`,
    );
  } else {
    console.log("Give the agent these two, and nothing else:");
    console.log(`  ${urlExport}`);
    console.log(keyLine);
    console.log(`and have it run Patcher as ${args.invocation}.`);
  }
  console.log(
    "The key is in that file rather than on this screen, so it stays out of this terminal's scrollback and out of the transcript of an agent that ran this command. `--print-key` prints it too.",
  );
  console.log(
    "With that, `patcher browser` works and every other Patcher API this CLI calls is refused.",
  );
}

interface McpInstallOutcome {
  configured: boolean;
  /** Why not, when it did not happen. */
  error?: string;
}

async function runMcpInstall(plan: McpInstallPlan): Promise<McpInstallOutcome> {
  try {
    await execFileAsync(plan.agentBinary, plan.argv);
    return { configured: true };
  } catch (error) {
    // Its binary is not on this PATH, or it refused. Either way there is
    // nothing half-done to undo: this never edits their config itself, it runs
    // their own command. The caller prints what to run instead.
    return {
      configured: false,
      error:
        error instanceof Error ? error.message.split("\n")[0] : String(error),
    };
  }
}

function printMcpInstallOutcome(
  plan: McpInstallPlan,
  outcome: McpInstallOutcome | null,
): void {
  const printed = quoteArgv(plan.agentBinary, plan.argv);
  // Said either way, because nothing else says it: the server is written into
  // the agent's config, and a session that was already running is not where
  // it shows up (#134).
  const restart = `Restart ${plan.agentName} before asking it to browse: the \`${MCP_SERVER_NAME}\` server is there in sessions started after this.`;
  console.log("");
  if (outcome?.configured === true) {
    console.log(`Added the \`${MCP_SERVER_NAME}\` MCP server:`);
    console.log(`  ${printed}`);
    console.log(restart);
    console.log(`Undo it with \`${plan.undo}\`.`);
    return;
  }
  console.log(
    `Could not run \`${plan.agentBinary} mcp add\`${outcome?.error === undefined ? "" : ` (${outcome.error})`}.`,
  );
  console.log("Run this yourself, in a shell where that binary is on PATH:");
  console.log(`  ${printed}`);
  console.log(restart);
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
      grant.revokedAt !== null
        ? `revoked ${formatWhen(grant.revokedAt)}`
        : grant.pausedAt !== null
          ? // Said before the last use, because it is the answer to the question
            // somebody runs this command with: why is it not working.
            `paused ${formatWhen(grant.pausedAt)}, last used ${formatWhen(grant.lastUsedAt)}`
          : `last used ${formatWhen(grant.lastUsedAt)}`;
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
    .option(
      "--print-key",
      "Print the key itself as well. It is written to a file either way; printed, it lands in this terminal's output, and in the transcript of an agent that ran this",
    )
    .action(
      action(async (label: string, opts: GrantOptions) => {
        const level = parseLevel(opts.level);
        const target = parseTarget(opts.for);
        const sdk = createCliPatcherSdk(getUrl());
        // Before minting, not after. The credential is handed over once and
        // cannot be asked for again, so a failure here after the row existed
        // would leave a live grant nobody holds — and `config` is only ever a
        // read. The key's directory is made here too, so a data dir this
        // cannot write to fails while there is nothing to take back.
        const config = await sdk.system.config();
        const server = await resolveMcpServerCommand(config.dataDir);
        const keyDir = join(config.dataDir, AGENT_KEY_DIR_NAME);
        await mkdir(keyDir, { recursive: true, mode: 0o700 });
        const result = await sdk.system.createBrowserAccessGrant({
          label,
          level,
        });
        const keyFile = join(keyDir, `${result.grant.id}.key`);
        try {
          // `wx`: a file already there is an error, not a key to write over.
          await writeFile(keyFile, `${result.key}\n`, {
            mode: 0o600,
            flag: "wx",
          });
        } catch (error) {
          // Taken back rather than left: the key is shown nowhere else, so a
          // grant whose file was never written is a credential nobody holds.
          await sdk.system.revokeBrowserAccessGrant(result.grant.id);
          throw new Error(
            `Could not write the key to ${keyFile} (${error instanceof Error ? error.message : String(error)}), so grant ${result.grant.id} was revoked straight away. Nobody holds a live credential from this.`,
          );
        }
        // `--for` is an act on this machine, not a way of printing the answer,
        // so `--json` does not skip it: a caller that asked for JSON *and* for
        // Codex to be configured asked for both.
        const delivery =
          target === "shell"
            ? null
            : buildMcpInstallPlan(target, server, {
                serverUrl: config.serverUrl,
                keyFile,
              });
        const installed =
          delivery === null ? null : await runMcpInstall(delivery);
        // The key only when asked for, in JSON as on the screen: both are
        // stdout, and stdout is what lands in a transcript.
        if (
          outputJson(opts, {
            grant: result.grant,
            browserToolsEnabled: result.browserToolsEnabled,
            keyFile,
            ...(opts.printKey === true ? { key: result.key } : {}),
            ...(installed ?? {}),
          })
        ) {
          return;
        }
        console.log(
          `Issued "${result.grant.label}" (${result.grant.id}) at level ${level}: ${permissionsForBrowserExternalAccess(level).join(", ")}.`,
        );
        // Enabling the plugin is a side effect on everybody else's behalf: it
        // hands every thread inside Patcher what `browser-tools` declares,
        // which is more than this grant does. Said either way rather than only
        // when it failed.
        console.log(
          result.browserToolsEnabled
            ? "The browser-tools plugin is on, so `patcher browser` is served — for threads inside Patcher too, with everything the plugin declares."
            : "The browser-tools plugin is not serving `patcher browser`, so nothing can use this grant yet. Check `patcher plugin list`.",
        );
        if (delivery === null) {
          printShellDelivery({
            serverUrl: config.serverUrl,
            keyFile,
            // The MCP server's command without its `mcp-serve`, which is how
            // this CLI is run from a shell.
            invocation: quoteArgv(server.command, server.args.slice(0, -1)),
            viaShim: server.command === resolveCliShimPath(config.dataDir),
          });
        } else {
          printMcpInstallOutcome(delivery, installed);
        }
        if (opts.printKey === true) {
          console.log("");
          console.log(
            `The key itself, as asked; \`${PATCHER_AGENT_KEY_ENV}\` works in place of the file:`,
          );
          console.log(
            `  export ${PATCHER_AGENT_KEY_ENV}=${quoteWord(result.key)}`,
          );
        }
        console.log("");
        console.log(
          `Take it back with \`patcher agent-access revoke ${result.grant.id}\`, or in Settings → General → Agents outside Patcher.`,
        );
      }),
    );

  agentAccess
    .command("pause <id>")
    .description("Stop a grant for now. It keeps working after `resume`")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: { json?: boolean }) => {
        const sdk = createCliPatcherSdk(getUrl());
        const result = await sdk.system.setBrowserAccessGrantPaused(id, true);
        if (outputJson(opts, result)) return;
        console.log(
          `Paused ${id}. Its next request is refused and told it is paused; \`patcher agent-access resume ${id}\` puts it back.`,
        );
        printGrantTable(result.grants);
      }),
    );

  agentAccess
    .command("resume <id>")
    .description("Let a paused grant work again")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: { json?: boolean }) => {
        const sdk = createCliPatcherSdk(getUrl());
        const result = await sdk.system.setBrowserAccessGrantPaused(id, false);
        if (outputJson(opts, result)) return;
        console.log(`Resumed ${id}.`);
        printGrantTable(result.grants);
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
