import { execFile } from "node:child_process";
import { access, constants, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  PATCHER_AGENT_KEY_ENV,
  PATCHER_AGENT_KEY_FILE_ENV,
} from "@patcher/config/agent-access-key";
import { resolveCliShimPath } from "@patcher/config/cli-shim";
import {
  parseDataDirEnvValue,
  resolveProdDataDir,
} from "@patcher/config/runtime";
import {
  BROWSER_ACCESS_GRANT_LEVELS,
  BROWSER_EXTERNAL_ACCESS_DESCRIPTIONS,
  browserAccessGrantLevelSchema,
  permissionsForBrowserExternalAccess,
  type BrowserAccessGrantLevel,
} from "@patcher/domain";
import type { PatcherSdk } from "@patcher/sdk/node";
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
 * Where a grant's key is written, one file per grant, under this machine's data
 * dir.
 *
 * Written rather than printed (#134). Printed, the key goes wherever that
 * terminal's output goes — and when an agent ran the command, that is its
 * transcript and its session log. The file is `0600`, and on the machine the
 * server runs on it sits beside the app key the server keeps there, readable by
 * exactly the processes that could already read that; an agent's config
 * holding the key itself was the same exposure, and a transcript is a wider one.
 */
const AGENT_KEY_DIR_NAME = "agent-keys";

/**
 * The data dir on the machine this CLI runs on, for the key file.
 *
 * Not the server's `config.dataDir`: the file is read by an agent running where
 * this CLI runs, and a CLI pointed at a server on another machine would try to
 * write into a path that exists only there. Resolved the way `plugin.ts` finds
 * its toolchain cache — `PATCHER_DATA_DIR`, which the shim sets to its own
 * install's, or the production default — so on the server's own machine it is
 * the same directory.
 */
function localDataDir(): string {
  const configured = process.env.PATCHER_DATA_DIR;
  return configured === undefined || configured.trim().length === 0
    ? resolveProdDataDir({ homeDir: homedir() })
    : parseDataDirEnvValue({ homeDir: homedir(), rawDataDir: configured });
}

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

/** `--level` is required here: `read` is rarely enough, and `browse` is not a default. */
interface RequestOptions {
  level: string;
  reason?: string;
  for?: string;
  json?: boolean;
}

/**
 * How long `request` waits in one run, and how often it asks.
 *
 * Well under two minutes, because the caller is an agent's shell tool, and
 * Claude Code's and Patcher's own MCP tool both stop a command at 120 seconds —
 * killed mid-wait, it would report nothing at all. Polling rather than holding a
 * request open, because the answer is a person's click and a second and a half
 * is faster than they are.
 */
const REQUEST_WAIT_MS = 90_000;
const REQUEST_POLL_MS = 1_500;

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

interface PreparedGrantDelivery {
  serverUrl: string;
  dataDir: string;
  server: { command: string; args: string[] };
  keyDir: string;
}

/**
 * Everything delivery needs, found before a grant exists.
 *
 * Before minting, not after. The credential is handed over once and cannot be
 * asked for again, so a failure here after the row existed would leave a live
 * grant nobody holds — and `config` is only ever a read. The key's directory is
 * made here too, so a data dir this cannot write to fails while there is
 * nothing to take back.
 */
async function prepareGrantDelivery(
  sdk: PatcherSdk,
): Promise<PreparedGrantDelivery> {
  const config = await sdk.system.config();
  const server = await resolveMcpServerCommand(config.dataDir);
  const keyDir = join(localDataDir(), AGENT_KEY_DIR_NAME);
  await mkdir(keyDir, { recursive: true, mode: 0o700 });
  return {
    serverUrl: config.serverUrl,
    dataDir: config.dataDir,
    server,
    keyDir,
  };
}

interface IssuedGrant {
  grant: SystemBrowserAccessGrant;
  key: string;
  browserToolsEnabled: boolean;
}

/**
 * Hand a grant that now exists to the agent it is for: its key into a file,
 * that agent's MCP config when `--for` names one, and what to do next.
 *
 * `asked` is the level a `request` asked for, which the person may have
 * answered lower. `printKey` is `grant`'s alone: `request` is run by the agent
 * itself, so a printed key would always land in its transcript (#134).
 */
async function deliverGrant(
  sdk: PatcherSdk,
  prepared: PreparedGrantDelivery,
  issued: IssuedGrant,
  target: GrantTarget,
  opts: { json?: boolean; printKey?: boolean; asked?: BrowserAccessGrantLevel },
): Promise<void> {
  const { grant, key } = issued;
  const keyFile = join(prepared.keyDir, `${grant.id}.key`);
  try {
    // `wx`: a file already there is an error, not a key to write over.
    await writeFile(keyFile, `${key}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    // Taken back rather than left: the key is shown nowhere else, so a grant
    // whose file was never written is a credential nobody holds.
    await sdk.system.revokeBrowserAccessGrant(grant.id);
    throw new Error(
      `Could not write the key to ${keyFile} (${error instanceof Error ? error.message : String(error)}), so grant ${grant.id} was revoked straight away. Nobody holds a live credential from this.`,
    );
  }
  // `--for` is an act on this machine, not a way of printing the answer, so
  // `--json` does not skip it: a caller that asked for JSON *and* for Codex to
  // be configured asked for both.
  const delivery =
    target === "shell"
      ? null
      : buildMcpInstallPlan(target, prepared.server, {
          serverUrl: prepared.serverUrl,
          keyFile,
        });
  const installed = delivery === null ? null : await runMcpInstall(delivery);
  // The key only when asked for, in JSON as on the screen: both are stdout, and
  // stdout is what lands in a transcript.
  if (
    outputJson(opts, {
      grant,
      browserToolsEnabled: issued.browserToolsEnabled,
      keyFile,
      ...(opts.printKey === true ? { key } : {}),
      ...(installed ?? {}),
    })
  ) {
    return;
  }
  if (opts.asked !== undefined && opts.asked !== grant.level) {
    console.log(
      `The person allowed "${grant.label}" at "${grant.level}", lower than the "${opts.asked}" asked for. A command needing more is still refused; that was their answer.`,
    );
  }
  console.log(
    `Issued "${grant.label}" (${grant.id}) at level ${grant.level}: ${permissionsForBrowserExternalAccess(grant.level).join(", ")}.`,
  );
  // Enabling the plugin is a side effect on everybody else's behalf: it hands
  // every thread inside Patcher what `browser-tools` declares, which is more
  // than this grant does. Said either way rather than only when it failed.
  console.log(
    issued.browserToolsEnabled
      ? "The browser-tools plugin is on, so `patcher browser` is served — for threads inside Patcher too, with everything the plugin declares."
      : "The browser-tools plugin is not serving `patcher browser`, so nothing can use this grant yet. Check `patcher plugin list`.",
  );
  if (delivery === null) {
    printShellDelivery({
      serverUrl: prepared.serverUrl,
      keyFile,
      // The MCP server's command without its `mcp-serve`, which is how this
      // CLI is run from a shell.
      invocation: quoteArgv(
        prepared.server.command,
        prepared.server.args.slice(0, -1),
      ),
      viaShim: prepared.server.command === resolveCliShimPath(prepared.dataDir),
    });
  } else {
    printMcpInstallOutcome(delivery, installed);
  }
  if (opts.printKey === true) {
    console.log("");
    console.log(
      `The key itself, as asked; \`${PATCHER_AGENT_KEY_ENV}\` works in place of the file:`,
    );
    console.log(`  export ${PATCHER_AGENT_KEY_ENV}=${quoteWord(key)}`);
  }
  console.log("");
  console.log(
    `Take it back with \`patcher agent-access revoke ${grant.id}\`, or in Settings → General → Agents outside Patcher.`,
  );
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
        const prepared = await prepareGrantDelivery(sdk);
        const issued = await sdk.system.createBrowserAccessGrant({
          label,
          level,
        });
        await deliverGrant(sdk, prepared, issued, target, opts);
      }),
    );

  agentAccess
    .command("request <label>")
    .description(
      "Ask the person, in Patcher's window, for a credential for one agent. The command an agent runs for itself",
    )
    .requiredOption(
      "--level <level>",
      `How far it needs to reach: ${BROWSER_ACCESS_GRANT_LEVELS.join(" | ")}`,
    )
    .option(
      "--reason <text>",
      "What it is needed for, shown to the person as written",
    )
    .option(
      "--for <target>",
      `Who it is for: ${GRANT_TARGETS.join(" | ")}. Anything but 'shell' writes that agent's own MCP config, through its own command`,
      "shell",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (label: string, opts: RequestOptions) => {
        const level = parseLevel(opts.level);
        const target = parseTarget(opts.for);
        const sdk = createCliPatcherSdk(getUrl());
        const prepared = await prepareGrantDelivery(sdk);
        const { request } = await sdk.system.requestBrowserAccess({
          label,
          level,
          ...(opts.reason === undefined ? {} : { reason: opts.reason }),
        });
        if (opts.json !== true) {
          console.log(
            `Asked the person at this machine, in Patcher's window — the row under its tabs, or Settings → General → Agents outside Patcher: "${request.label}" asks for "${BROWSER_EXTERNAL_ACCESS_DESCRIPTIONS[request.level].label}". Waiting up to ${REQUEST_WAIT_MS / 1000} seconds for their answer.`,
          );
        }
        const deadline = Date.now() + REQUEST_WAIT_MS;
        const stillWaiting = () =>
          // Bounded well under an agent's own tool timeout, which would
          // otherwise kill this mid-wait and report nothing (#135). The request
          // stays open, and asking again resumes it.
          new Error(
            `No answer yet from the person at this machine, and nothing has been granted. The request is still open in Patcher's window until ${new Date(request.expiresAt).toISOString()}; run the same command again to keep waiting for it.`,
          );
        for (;;) {
          // Raced against the deadline, so one poll that stalls — a server
          // elsewhere on a bad network — cannot carry the wait past it.
          let timer: ReturnType<typeof setTimeout> | undefined;
          const outcome = await Promise.race([
            sdk.system.browserAccessRequestOutcome(request.id),
            new Promise<null>((resolve) => {
              timer = setTimeout(
                () => resolve(null),
                Math.max(deadline - Date.now(), 0),
              );
            }),
          ]).finally(() => clearTimeout(timer));
          if (outcome === null) throw stillWaiting();
          if (outcome.outcome === "denied") {
            throw new Error(
              `The person at this machine answered no to "${request.label}". Nothing was granted. Do not ask again, and do not run \`agent-access grant\` or \`settings browser-access\` instead: from this shell they take effect with nobody asked, and the answer was theirs to give. If you think they misread, say so to them in words.`,
            );
          }
          if (outcome.outcome === "approved") {
            await deliverGrant(sdk, prepared, outcome, target, {
              json: opts.json,
              asked: level,
            });
            return;
          }
          if (Date.now() >= deadline) throw stillWaiting();
          await new Promise((resolve) => setTimeout(resolve, REQUEST_POLL_MS));
        }
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
