import { execFile } from "node:child_process";
import { PATCHER_AGENT_KEY_ENV } from "@patcher/config/agent-access-key";
import { Command } from "commander";

/**
 * This CLI, offered to a turn as an MCP tool instead of a shell command.
 *
 * A Codex turn reaches Patcher by running `patcher` in its own shell, over
 * loopback — which is why Codex's network cannot be turned off without taking
 * the CLI with it. An MCP server is spawned by the provider process rather than
 * by a sandboxed shell, so it sits outside the command sandbox: measured, with
 * the turn's own `curl` unable to resolve a host while a tool call from here
 * reached the server. That is the whole point of this command existing.
 *
 * **One tool, and it runs this CLI.** Not a second surface: a set of purpose-
 * built tools would be a copy of the CLI that drifts from it with every change.
 * The tool takes the arguments the binary takes, and runs them by re-invoking
 * this entry point — `execFile`, never a shell, so nothing about the arguments
 * can turn into another command.
 *
 * **Not every argument, though.** Being outside the sandbox is what makes this
 * transport work and is also the whole of its risk: the CLI has commands that
 * open a path on this machine, and here that path is bounded by nothing. So the
 * argv has to name one of the API commands — `MCP_TOOL_COMMANDS` below says
 * which, and why the list is of what may run rather than of what may not.
 *
 * The app key is dropped from the child's environment, and `client.ts` would
 * ignore it anyway while a thread key is present. Belt and braces on the one
 * seam where a credential could widen: this process is not sandboxed, so a CLI
 * here that spoke for the app rather than for the thread would be an escalation
 * rather than a convenience.
 */

const PROTOCOL_VERSION_FALLBACK = "2025-06-18";
const TOOL_NAME = "patcher";
const TOOL_TIMEOUT_MS = 120_000;
const TOOL_MAX_OUTPUT_BYTES = 1024 * 1024;

const TOOL_DESCRIPTION = [
  "Run a Patcher CLI command and return its output.",
  "Patcher's API commands — pass argv as an array, without the leading `patcher`.",
  'Examples: ["status"], ["thread","list","--json"], ["thread","tell","thr_1","done"].',
  "Prefer this over running `patcher` in a shell: it works when the turn has no network.",
  "Commands that read, write or run something on the machine are refused here — run those in your own shell.",
].join(" ");

/**
 * The same tool, when this server was started with a browser access grant.
 *
 * A grant reaches two routes and neither of them is `thread` or `project`, so
 * every command in the list below would come back as a 403 with a paragraph
 * about credentials. Describing the tool as "Patcher's API commands" and then
 * refusing all but one of them is the failure mode this whole module was
 * written against: a model told only "no" tries again.
 */
const GRANT_TOOL_DESCRIPTION = [
  "Drive Patcher's browser and return the output.",
  "Pass argv as an array, without the leading `patcher`; every call starts with `browser`.",
  'Examples: ["browser","tabs"], ["browser","open","https://example.com","--background"], ["browser","text","--tab","t1"].',
  'Run `["browser","--help"]` for the command list, and `["browser","<command>","--help"]` for one command.',
  "This credential reaches `patcher browser` and no other Patcher API — the rest of the CLI is refused here.",
].join(" ");

/**
 * What this tool will run, and why it is a list of what it *will* rather than
 * of what it will not.
 *
 * The process this spawns is outside the turn's command sandbox — that is what
 * the transport is for — so the same CLI reaches paths the turn's own shell
 * cannot. Both halves of that were measured against this server rather than
 * reasoned about: a call with
 * `["project","attachment","upload","<id>","--client-file","<any path>"]` opened
 * that path and got as far as the network, and `["plugin","types","<any dir>"]`
 * wrote a file into a directory of the caller's choosing with no server involved
 * at all. So a rule that named the options which take a path would have closed
 * the first and missed the second.
 *
 * What is left is the CLI's API surface: the commands whose whole effect is a
 * request to `/api/v1` carrying the thread key, where `agent-route-policy.ts`
 * and `agent-thread-scope.ts` already say what a turn may do — and say it the
 * same way whether the request came from here or from the turn's shell. Anything
 * that acts on this machine instead — reads a file, writes one, runs another
 * process — is not here, and is not lost either: it belongs in the turn's own
 * shell, where the sandbox bounds which paths it can name.
 *
 * A list of what may run rather than of what may not, which is the opposite
 * choice from `agent-route-policy.ts` and it is the opposite for a reason. A
 * forgotten entry there is a 403 in front of a person mid-task; a forgotten
 * entry here is a model being told to use the shell it already has. The two
 * mistakes are not the same size, and here they point the other way — so a
 * command added to this CLI tomorrow is refused through this tool until somebody
 * decides otherwise, and `mcp-tool-surface.test.ts` is where that decision is
 * recorded.
 */
/**
 * What the tool will run when it holds a browser access grant instead of a
 * thread key: the browser, which is the whole of what such a grant opens.
 */
const MCP_TOOL_GRANT_COMMANDS: readonly string[] = ["browser"];

/**
 * Whether this server speaks for a grant rather than for a thread.
 *
 * Read from the environment the parent put the server in, not from a flag: the
 * same `patcher mcp-serve` command is written into Claude Code's or Codex's
 * config either way, and what differs is the credential beside it.
 */
function servingBrowserAccessGrant(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (env[PATCHER_AGENT_KEY_ENV] ?? "").trim().length > 0;
}

const MCP_TOOL_COMMANDS: readonly string[] = [
  "environment",
  "file",
  "guide",
  "machine",
  "manager",
  "project",
  "provider",
  "settings",
  "skill",
  "status",
  "terminal",
  "theme",
  "thread",
  "updates",
];

interface RefusedMcpToolCommand {
  /** Space-separated command path, matched against the head of the argv. */
  path: string;
  reason: string;
}

/**
 * The commands under one of those that this tool will not run.
 *
 * Each takes a path on this machine and opens it, and this process is the one
 * place where that path is not bounded by the sandbox the turn runs in. Nothing
 * about them is lost: the file they mean is in the workspace, and the turn's own
 * shell is where the workspace is.
 */
const MCP_TOOL_REFUSED_COMMANDS: readonly RefusedMcpToolCommand[] = [
  {
    path: "project attachment",
    reason:
      "it reads or writes a file at a path on this machine, and this tool is not inside your sandbox",
  },
  {
    path: "skill update",
    reason:
      "it reads the replacement SKILL.md from a path on this machine, and this tool is not inside your sandbox",
  },
];

/**
 * Argv that names no command: program help and version, which do nothing.
 * `enablePositionalOptions()` means nothing else can precede a subcommand.
 */
const MCP_TOOL_BARE_ARGS: readonly string[] = [
  "--help",
  "-h",
  "--version",
  "-V",
  "help",
];

/** Whether the argv starts with this command path, segment by segment. */
function argvStartsWithCommand(args: readonly string[], path: string): boolean {
  return path.split(" ").every((segment, index) => args[index] === segment);
}

/**
 * Why this tool refuses to run these arguments, or null when it will run them.
 *
 * The refusal is a tool error rather than a protocol error, and it names the
 * shell as the way to do it: a model that is told only "no" tries again.
 */
export function mcpToolArgvRefusal(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const command = args[0];
  if (command === undefined || MCP_TOOL_BARE_ARGS.includes(command)) {
    return null;
  }
  if (servingBrowserAccessGrant(env)) {
    // Refused here as well as by the server, and both are wanted: the server
    // is the boundary, and this is the sentence that tells a model to stop —
    // a 403 about credentials reads like something to work around.
    return MCP_TOOL_GRANT_COMMANDS.some((allowed) =>
      argvStartsWithCommand(args, allowed),
    )
      ? null
      : `This tool was started with a browser access grant, which reaches \`patcher browser\` and no other Patcher API, so \`patcher ${command}\` is not available through it. Available here: ${MCP_TOOL_GRANT_COMMANDS.join(", ")}. Ask the person at this machine if you need more than the browser.`;
  }
  const refused = MCP_TOOL_REFUSED_COMMANDS.find((entry) =>
    argvStartsWithCommand(args, entry.path),
  );
  if (refused !== undefined) {
    return `This tool will not run \`patcher ${refused.path}\`: ${refused.reason}. Run it in your own shell, where your workspace is.`;
  }
  if (
    MCP_TOOL_COMMANDS.some((allowed) => argvStartsWithCommand(args, allowed))
  ) {
    return null;
  }
  return `This tool runs Patcher's API commands, and \`patcher ${command}\` is not one of them. It spawns the CLI outside the sandbox your turn runs in, so anything that touches this machine belongs in your own shell instead. Available here: ${MCP_TOOL_COMMANDS.join(", ")}.`;
}

interface JsonRpcRequest {
  id?: number | string | null;
  method?: string;
  params?: { protocolVersion?: string; name?: string; arguments?: unknown };
}

interface ToolRunResult {
  text: string;
  isError: boolean;
}

/** The environment a `patcher` child gets: this one, minus the app key. */
function childEnvironment(): NodeJS.ProcessEnv {
  const { PATCHER_APP_KEY: _appKey, ...rest } = process.env;
  return rest;
}

function runPatcherCliArgs(args: readonly string[]): Promise<ToolRunResult> {
  return new Promise((resolve) => {
    // This entry point, re-invoked. `process.argv[1]` is the built CLI the bin
    // wrapper exec'd, so it needs no PATH and cannot resolve to another binary.
    const selfEntry = process.argv[1];
    if (selfEntry === undefined) {
      resolve({
        isError: true,
        text: "Cannot locate this CLI entry point to run a command.",
      });
      return;
    }
    execFile(
      process.execPath,
      [selfEntry, ...args],
      {
        env: childEnvironment(),
        maxBuffer: TOOL_MAX_OUTPUT_BYTES,
        timeout: TOOL_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        const output = [stdout, stderr]
          .map((stream) => stream.toString().trimEnd())
          .filter((stream) => stream.length > 0)
          .join("\n");
        if (error === null) {
          resolve({ isError: false, text: output || "(no output)" });
          return;
        }
        // The CLI's own message is the useful part; the exit code alone tells a
        // model nothing it can act on.
        resolve({
          isError: true,
          text: output || error.message,
        });
      },
    );
  });
}

function parseToolArguments(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  return value.every((entry) => typeof entry === "string")
    ? [...(value as string[])]
    : null;
}

interface McpServeIo {
  stdin: NodeJS.ReadableStream;
  write: (line: string) => void;
  /**
   * How a tool call runs. Injectable for tests and nothing else: the real one
   * re-invokes this process's own entry point, and under a test runner
   * `process.argv[1]` is the runner, so a test that used it would run the
   * runner. The real path is measured against a live Codex turn instead.
   */
  runCli?: (args: readonly string[]) => Promise<ToolRunResult>;
}

/**
 * Serve MCP over newline-delimited JSON-RPC.
 *
 * Hand-written rather than taken from an SDK: three methods, no notifications
 * to send, and the transport is one line of JSON each way. A dependency here
 * would also be a dependency of the CLI, which every turn runs.
 */
export function serveMcpOverStdio(io: McpServeIo): void {
  let buffer = "";
  const send = (message: unknown) => {
    io.write(`${JSON.stringify(message)}\n`);
  };

  const handle = async (request: JsonRpcRequest): Promise<void> => {
    const { id, method } = request;
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion:
            request.params?.protocolVersion ?? PROTOCOL_VERSION_FALLBACK,
          capabilities: { tools: {} },
          serverInfo: { name: "patcher", version: "1.0.0" },
        },
      });
      return;
    }
    if (method === "tools/list") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: TOOL_NAME,
              description: servingBrowserAccessGrant()
                ? GRANT_TOOL_DESCRIPTION
                : TOOL_DESCRIPTION,
              inputSchema: {
                type: "object",
                properties: {
                  args: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      "CLI arguments, without the leading `patcher`.",
                  },
                },
                required: ["args"],
              },
            },
          ],
        },
      });
      return;
    }
    if (method === "tools/call") {
      if (request.params?.name !== TOOL_NAME) {
        send({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: `Unknown tool: ${String(request.params?.name)}`,
          },
        });
        return;
      }
      const args = parseToolArguments(
        (request.params.arguments as { args?: unknown } | undefined)?.args,
      );
      if (args === null) {
        // A tool error rather than a protocol error: the model gets to read it
        // and try again, which a JSON-RPC error code does not give it.
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: "`args` must be an array of strings, without the leading `patcher`.",
              },
            ],
            isError: true,
          },
        });
        return;
      }
      const refusal = mcpToolArgvRefusal(args);
      if (refusal !== null) {
        // A tool error, like the two above: the model is told which shell to
        // use, and a protocol error would leave it guessing.
        send({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: refusal }], isError: true },
        });
        return;
      }
      const result = await (io.runCli ?? runPatcherCliArgs)(args);
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: result.text }],
          isError: result.isError,
        },
      });
      return;
    }
    // Notifications carry no id and want no answer.
    if (id === undefined || id === null) return;
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unsupported method: ${String(method)}` },
    });
  };

  io.stdin.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (line.length === 0) continue;
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(line) as JsonRpcRequest;
      } catch {
        // A line that is not JSON is not a request to answer: there is no id to
        // answer to, and the peer is the provider rather than a person.
        continue;
      }
      void handle(request);
    }
  });
}

export function registerMcpServeCommand(program: Command): void {
  program
    .command("mcp-serve", { hidden: true })
    .description(
      "Serve this CLI as an MCP server on stdio (used by a turn's provider, not by people)",
    )
    .action(() => {
      // Nothing else may write to stdout: it is the transport. The CLI's own
      // output reaches a caller as tool text instead.
      serveMcpOverStdio({
        stdin: process.stdin,
        write: (line) => process.stdout.write(line),
      });
      process.stdin.resume();
    });
}
