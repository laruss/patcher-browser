import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  mcpToolArgvRefusal,
  serveMcpOverStdio,
} from "../commands/mcp-serve.js";

/**
 * The CLI as an MCP server, at the protocol level.
 *
 * The transport is newline-delimited JSON each way, and a provider is the peer
 * — so a malformed line, an unknown tool or bad arguments must not end the
 * process: the turn would lose the tool for the rest of its life. Running the
 * CLI is injected here on purpose; that path re-invokes this process's entry
 * point, which under a test runner is the runner, and it is measured against a
 * live Codex turn instead.
 */

function createHarness(
  runCli?: (args: readonly string[]) => Promise<{
    text: string;
    isError: boolean;
  }>,
) {
  const stdin = new EventEmitter() as EventEmitter & NodeJS.ReadableStream;
  const lines: string[] = [];
  serveMcpOverStdio({
    stdin,
    write: (line) => lines.push(line),
    ...(runCli ? { runCli } : {}),
  });
  const send = (message: unknown) => {
    stdin.emit("data", `${JSON.stringify(message)}\n`);
  };
  const replies = () => lines.map((line) => JSON.parse(line));
  return { lines, replies, send, stdin };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("serveMcpOverStdio", () => {
  it("answers initialize with the protocol version the client asked for", () => {
    const harness = createHarness();

    harness.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2099-01-01" },
    });

    expect(harness.replies()[0]).toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2099-01-01",
        capabilities: { tools: {} },
        serverInfo: { name: "patcher" },
      },
    });
  });

  it("offers one tool, which takes CLI arguments", () => {
    const harness = createHarness();

    harness.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });

    const [reply] = harness.replies();
    expect(reply.result.tools).toHaveLength(1);
    const [tool] = reply.result.tools;
    expect(tool.name).toBe("patcher");
    // The description is what a model reads to decide to use this instead of a
    // shell, so it has to say that much.
    expect(tool.description).toContain("Patcher CLI");
    expect(tool.description).toContain("no network");
    expect(tool.inputSchema.properties.args.items.type).toBe("string");
  });

  it("runs the arguments it was given, verbatim", async () => {
    const runCli = vi.fn(async (args: readonly string[]) => ({
      isError: false,
      text: `ran: ${args.join(" ")}`,
    }));
    const harness = createHarness(runCli);

    harness.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "patcher", arguments: { args: ["thread", "list"] } },
    });
    await flush();

    expect(runCli).toHaveBeenCalledWith(["thread", "list"]);
    expect(harness.replies()[0]).toMatchObject({
      id: 3,
      result: {
        content: [{ type: "text", text: "ran: thread list" }],
        isError: false,
      },
    });
  });

  it("returns a failing command as a tool error, not a protocol error", async () => {
    const harness = createHarness(async () => ({
      isError: true,
      text: "Error: no such thread",
    }));

    harness.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "patcher", arguments: { args: ["thread", "show", "x"] } },
    });
    await flush();

    // `isError` on the result rather than a JSON-RPC error: the model gets to
    // read what went wrong and try something else.
    const [reply] = harness.replies();
    expect(reply.error).toBeUndefined();
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toContain("no such thread");
  });

  it("says what is wrong with arguments that are not strings", async () => {
    const runCli = vi.fn();
    const harness = createHarness(runCli as never);

    harness.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "patcher", arguments: { args: ["thread", 7] } },
    });
    await flush();

    expect(runCli).not.toHaveBeenCalled();
    expect(harness.replies()[0].result).toMatchObject({
      isError: true,
      content: [
        { type: "text", text: expect.stringContaining("array of strings") },
      ],
    });
  });

  it("keeps serving after a line that is not JSON, and after an unknown method", async () => {
    const harness = createHarness(async () => ({ isError: false, text: "ok" }));

    harness.stdin.emit("data", "not json at all\n");
    harness.send({ jsonrpc: "2.0", id: 6, method: "resources/list" });
    harness.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    harness.send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "patcher", arguments: { args: ["status"] } },
    });
    await flush();

    const replies = harness.replies();
    // The unknown method is answered, the notification is not, the unparsable
    // line is ignored — and the tool call after all three still works.
    expect(replies).toHaveLength(2);
    expect(replies[0]).toMatchObject({ id: 6, error: { code: -32601 } });
    expect(replies[1]).toMatchObject({ id: 7, result: { isError: false } });
  });

  it("reassembles a request split across chunks", async () => {
    const harness = createHarness(async () => ({ isError: false, text: "ok" }));
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "patcher", arguments: { args: ["status"] } },
    });

    harness.stdin.emit("data", request.slice(0, 20));
    harness.stdin.emit("data", `${request.slice(20)}\n`);
    await flush();

    expect(harness.replies()[0]).toMatchObject({ id: 8 });
  });

  it("refuses an argv that would open a path on this machine", async () => {
    const runCli = vi.fn();
    const harness = createHarness(runCli as never);

    harness.send({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "patcher",
        arguments: {
          args: [
            "project",
            "attachment",
            "upload",
            "prj_1",
            "--client-file",
            "/Users/someone/.patcher/app-api-key",
          ],
        },
      },
    });
    await flush();

    // The CLI is never reached: this process is outside the turn's sandbox, so
    // the path in that argv is bounded by nothing.
    expect(runCli).not.toHaveBeenCalled();
    const [reply] = harness.replies();
    expect(reply.error).toBeUndefined();
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toContain("project attachment");
    expect(reply.result.content[0].text).toContain("your own shell");
  });

  it("refuses a command that is not Patcher's API, and says what is here", async () => {
    const runCli = vi.fn();
    const harness = createHarness(runCli as never);

    harness.send({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "patcher",
        arguments: { args: ["plugin", "types", "/Users/someone/plugin"] },
      },
    });
    await flush();

    expect(runCli).not.toHaveBeenCalled();
    const text = harness.replies()[0].result.content[0].text;
    expect(text).toContain("`patcher plugin`");
    // A model told only "no" tries again, so the refusal lists the way through.
    expect(text).toContain("thread");
  });

  it("refuses a tool it does not have", async () => {
    const harness = createHarness();

    harness.send({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "rm", arguments: {} },
    });
    await flush();

    expect(harness.replies()[0]).toMatchObject({
      id: 9,
      error: { code: -32602, message: expect.stringContaining("rm") },
    });
  });
});

describe("mcpToolArgvRefusal", () => {
  it("runs the API commands, and the argv that names no command at all", () => {
    for (const args of [
      [],
      ["--help"],
      ["--version"],
      ["help", "thread"],
      ["status"],
      ["thread", "tell", "thr_1", "done"],
      ["project", "list"],
      ["settings", "show"],
      ["file", "read", "/etc/hosts"],
    ]) {
      expect(mcpToolArgvRefusal(args)).toBeNull();
    }
  });

  it("refuses what is not on the list, matching whole segments", () => {
    // `project` is here and `project attachment` is not, so the exception has to
    // be read before the family — and a longer name that merely starts the same
    // way is neither.
    expect(mcpToolArgvRefusal(["project", "attachment", "upload"])).toContain(
      "project attachment",
    );
    expect(mcpToolArgvRefusal(["projects", "list"])).toContain(
      "patcher projects",
    );
    expect(
      mcpToolArgvRefusal(["voice", "transcribe", "/tmp/a.webm"]),
    ).toContain("not one of them");
    // A plugin's own `patcher` command reaches the server through the CLI, but
    // only the running server knows its name, so the tool cannot admit it.
    expect(mcpToolArgvRefusal(["tasks", "list"])).not.toBeNull();
  });
});
