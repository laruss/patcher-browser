import { execFile } from "node:child_process";
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
 * The tool takes the same arguments the binary takes, and runs them by
 * re-invoking this entry point — `execFile`, never a shell, so nothing about
 * the arguments can turn into another command. What it can do is exactly what
 * the CLI can do with the credential it was handed, which is the thread key the
 * turn's shell already carries.
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
  "Same commands as the `patcher` binary — pass argv as an array, without the leading `patcher`.",
  'Examples: ["status"], ["thread","list","--json"], ["thread","tell","thr_1","done"].',
  "Prefer this over running `patcher` in a shell: it works when the turn has no network.",
].join(" ");

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
              description: TOOL_DESCRIPTION,
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
