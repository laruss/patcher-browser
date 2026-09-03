import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DynamicTool, ReasoningLevel } from "@patcher/domain";
import {
  captureBridgeJsonRpcOutput,
  type BridgeJsonRpcOutputMessage,
  type CapturedBridgeJsonRpcOutput,
} from "../../test/bridge-json-rpc-test-helpers.js";
import { handleLine } from "./bridge.js";
import { ACP_BRIDGE_MCP_SERVER_NAME } from "./tool-proxy-mcp.js";

/** Socket directories this suite made, removed after each test. */
const socketDirs: string[] = [];

const FAKE_AGENT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fake-acp-agent.mjs",
);

let output: CapturedBridgeJsonRpcOutput;
let workspaceDir: string;
let nextThreadSerial = 0;
const startedProviderThreadIds: string[] = [];
let nextRequestId = 1;
const realSetTimeout = setTimeout;

function requestId(): number {
  nextRequestId += 1;
  return nextRequestId;
}

function sendRequest(method: string, params: object): number {
  const id = requestId();
  handleLine(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  return id;
}

async function waitFor<T>(
  resolveValue: () => T | undefined,
  description: string,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = resolveValue();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolveTick) => setTimeout(resolveTick, 20));
  }
}

async function waitForFileWithRealTimer(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(path)) {
      return;
    }
    await new Promise((resolveTick) => realSetTimeout(resolveTick, 20));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function findResponse(id: number): BridgeJsonRpcOutputMessage | undefined {
  return output.messages.find((message) => message.id === id);
}

async function waitForResponse(
  id: number,
): Promise<BridgeJsonRpcOutputMessage> {
  return waitFor(() => findResponse(id), `response ${id}`);
}

function notifications(method: string): BridgeJsonRpcOutputMessage[] {
  return output.messages.filter((message) => message.method === method);
}

interface StartThreadArgs {
  permissionMode?: "accept-edits" | "full";
  permissionEscalation?: "ask" | "deny" | null;
  protectedCredentialPaths?: string[];
  protectedRepositoryPaths?: string[];
  envVars?: Record<string, string>;
  instructions?: string;
  agent?: { command: string; args: string[] };
  agentSandbox?: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    loopbackSocketDir?: string;
  };
  agentSandboxWarning?: string;
  dynamicTools?: DynamicTool[];
  modelSelection?:
    | {
        listCommand: { command: string; args: string[] };
        selectFlag: string;
        model: string;
        reasoningLevel?: ReasoningLevel;
      }
    | { modelId: string; reasoningLevel?: ReasoningLevel };
  launchReasoningLevel?: ReasoningLevel;
  reasoningCli?: {
    flag: string;
    supportedLevels: ReasoningLevel[];
    levelValues?: Partial<Record<ReasoningLevel, string>>;
    defaultLevel?: ReasoningLevel;
  };
  nativeReasoning?: {
    configId: string;
    supportedLevels: ReasoningLevel[];
    levelValues?: Partial<Record<ReasoningLevel, string>>;
    defaultLevel?: ReasoningLevel;
  };
  permissionCli?: {
    full?: string[];
    workspaceWrite?: string[];
    readonly?: string[];
    insertAfterArgs?: number;
  };
}

async function startThread(args?: StartThreadArgs): Promise<{
  patcherThreadId: string;
  providerThreadId: string;
}> {
  nextThreadSerial += 1;
  const patcherThreadId = `thread-${nextThreadSerial}`;
  const id = sendRequest("thread/start", {
    threadId: patcherThreadId,
    cwd: workspaceDir,
    agent: args?.agent ?? {
      command: process.execPath,
      args: [FAKE_AGENT_PATH],
    },
    ...(args?.agentSandbox ? { agentSandbox: args.agentSandbox } : {}),
    ...(args?.agentSandboxWarning
      ? { agentSandboxWarning: args.agentSandboxWarning }
      : {}),
    ...(args?.modelSelection ? { modelSelection: args.modelSelection } : {}),
    ...(args?.launchReasoningLevel !== undefined
      ? { launchReasoningLevel: args.launchReasoningLevel }
      : {}),
    ...(args?.reasoningCli !== undefined
      ? { reasoningCli: args.reasoningCli }
      : {}),
    ...(args?.nativeReasoning !== undefined
      ? { nativeReasoning: args.nativeReasoning }
      : {}),
    ...(args?.permissionCli !== undefined
      ? { permissionCli: args.permissionCli }
      : {}),
    permissionMode: args?.permissionMode ?? "full",
    permissionEscalation:
      args?.permissionEscalation === undefined
        ? null
        : args.permissionEscalation,
    workspaceWriteRoots: [workspaceDir],
    protectedCredentialPaths: args?.protectedCredentialPaths ?? [],
    protectedRepositoryPaths: args?.protectedRepositoryPaths ?? [],
    ...(args?.envVars ? { envVars: args.envVars } : {}),
    ...(args?.instructions ? { instructions: args.instructions } : {}),
    ...(args?.dynamicTools ? { dynamicTools: args.dynamicTools } : {}),
  });
  const response = await waitForResponse(id);
  if (response.error) {
    throw new Error(`thread/start failed: ${response.error.message}`);
  }
  const result = response.result;
  if (
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result) ||
    typeof result.providerThreadId !== "string"
  ) {
    throw new Error("thread/start did not return a providerThreadId");
  }
  startedProviderThreadIds.push(result.providerThreadId);
  return { patcherThreadId, providerThreadId: result.providerThreadId };
}

async function stopThread(providerThreadId: string): Promise<void> {
  const id = sendRequest("thread/stop", { threadId: providerThreadId });
  await waitForResponse(id);
}

async function waitForTurnCompleted(): Promise<BridgeJsonRpcOutputMessage> {
  return waitFor(
    () => notifications("acp/turn/completed").at(-1),
    "acp/turn/completed notification",
  );
}

async function waitForCompactionCompleted(): Promise<BridgeJsonRpcOutputMessage> {
  return waitFor(
    () => notifications("acp/compaction/completed").at(-1),
    "acp/compaction/completed notification",
  );
}

/**
 * A path with its `..` still in it: `join` collapses that away as text, which
 * is exactly the thing these two tests are about.
 */
function pathKeepingDotDot(...segments: string[]): string {
  return segments.join(sep);
}

/**
 * The one agent message that starts with `prefix`, for asserting its reason.
 *
 * Throws with the whole transcript rather than answering undefined: the message
 * being absent is the interesting failure, and `toContain` on undefined says
 * only that undefined is not a string.
 */
function agentMessageStartingWith(prefix: string): string {
  const message = agentMessageTexts().find((text) => text.startsWith(prefix));
  if (message === undefined) {
    throw new Error(
      `No agent message starting with "${prefix}". Messages: ${agentMessageTexts().join(" | ")}`,
    );
  }
  return message;
}

function agentMessageTexts(): string[] {
  return notifications("acp/update").flatMap((message) => {
    const params = message.params;
    if (
      typeof params !== "object" ||
      params === null ||
      Array.isArray(params)
    ) {
      return [];
    }
    const update = params.update;
    if (
      typeof update !== "object" ||
      update === null ||
      Array.isArray(update)
    ) {
      return [];
    }
    if (update.sessionUpdate !== "agent_message_chunk") {
      return [];
    }
    const content = update.content;
    if (
      typeof content !== "object" ||
      content === null ||
      Array.isArray(content) ||
      typeof content.text !== "string"
    ) {
      return [];
    }
    return [content.text];
  });
}

function callDynamicToolBridge(args: {
  callId: string;
  host: string;
  port: number;
  threadId: string;
  token: string;
  tool: string;
  toolArguments: Record<string, unknown>;
}): Promise<unknown> {
  return new Promise((resolveCall, rejectCall) => {
    const socket = createConnection({ host: args.host, port: args.port });
    let buffer = "";
    let settled = false;
    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      rejectCall(error);
    };
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(
        `${JSON.stringify({
          arguments: args.toolArguments,
          callId: args.callId,
          threadId: args.threadId,
          token: args.token,
          tool: args.tool,
        })}\n`,
      );
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }
      const line = buffer.slice(0, newlineIndex);
      socket.end();
      if (settled) {
        return;
      }
      settled = true;
      try {
        resolveCall(JSON.parse(line));
      } catch (error) {
        rejectCall(error);
      }
    });
    socket.on("error", rejectOnce);
    socket.on("end", () => {
      if (!settled) {
        rejectOnce(
          new Error("Dynamic tool bridge socket closed without a response"),
        );
      }
    });
  });
}

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "patcher-acp-bridge-test-"));
  output = captureBridgeJsonRpcOutput();
});

afterEach(async () => {
  for (const providerThreadId of startedProviderThreadIds.splice(0)) {
    await stopThread(providerThreadId);
  }
  vi.unstubAllEnvs();
  output.restore();
  rmSync(workspaceDir, { recursive: true, force: true });
  for (const socketDir of socketDirs.splice(0)) {
    rmSync(socketDir, { recursive: true, force: true });
  }
});

describe("acp bridge", () => {
  it("answers initialize and lists grouped models without spawning an agent", async () => {
    const initializeId = sendRequest("initialize", {
      clientInfo: { name: "Patcher", version: "1.0.0" },
    });
    expect((await waitForResponse(initializeId)).result).toEqual({ ok: true });

    const modelListId = sendRequest("model/list", {
      listCommand: {
        command: process.execPath,
        args: [
          "-e",
          'console.log("Available models\\n\\nauto - Auto\\ngrouped-1-low - Grouped One Low\\ngrouped-1 - Grouped One\\ngrouped-1-high - Grouped One High")',
        ],
      },
      primaryModels: ["auto"],
    });
    const response = await waitForResponse(modelListId);
    expect(response.result).toMatchObject({
      models: [{ id: "auto", displayName: "Auto", isDefault: true }],
      selectedOnlyModels: [
        {
          id: "grouped-1",
          displayName: "Grouped One",
          isDefault: false,
          defaultReasoningEffort: "medium",
        },
      ],
    });
    const selectedOnly = (
      response.result as {
        selectedOnlyModels: {
          supportedReasoningEfforts: { reasoningEffort: string }[];
        }[];
      }
    ).selectedOnlyModels;
    expect(
      selectedOnly[0]?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["low", "medium", "high"]);
  });

  it("answers a minimal model/list (no params) with the synthetic default", async () => {
    // The packaged-bridge smoke test sends `model/list` with empty params and
    // no agent binary on PATH; the bridge must still respond (not hang) so the
    // generic cross-bridge smoke contract holds.
    const modelListId = sendRequest("model/list", {});
    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [{ id: "acp-default", isDefault: true }],
      selectedOnlyModels: [],
    });
  });

  it("uses the CLI model list before ACP-native session discovery when both are present", async () => {
    const modelListId = sendRequest("model/list", {
      listCommand: {
        command: process.execPath,
        args: ["-e", 'console.log("cli-model - CLI Model")'],
      },
      agent: {
        command: "/nonexistent/acp-session-discovery-agent",
        args: [],
      },
      primaryModels: [],
    });

    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [{ id: "cli-model", displayName: "CLI Model", isDefault: true }],
      selectedOnlyModels: [],
    });
  });

  it("discovers ACP-native models and per-model reasoning from session configOptions", async () => {
    const modelListId = sendRequest("model/list", {
      agent: {
        command: process.execPath,
        args: [FAKE_AGENT_PATH],
        envVars: {
          FAKE_ACP_MODEL_CONFIG: "1",
          FAKE_ACP_THOUGHT_LEVEL_CONFIG: "1",
        },
      },
      primaryModels: [],
    });

    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [
        {
          id: "fake/default",
          model: "fake/default",
          displayName: "Fake Default",
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
        },
        {
          id: "fake/strong",
          model: "fake/strong",
          displayName: "Fake Strong",
          isDefault: false,
          defaultReasoningEffort: "none",
          supportedReasoningEfforts: [
            { reasoningEffort: "none" },
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
            { reasoningEffort: "xhigh" },
          ],
        },
      ],
      selectedOnlyModels: [],
    });
  });

  it("discovers ACP-native models from session models state", async () => {
    const modelListId = sendRequest("model/list", {
      agent: {
        command: process.execPath,
        args: [FAKE_AGENT_PATH],
        envVars: { FAKE_ACP_MODELS_FIELD: "1" },
      },
      primaryModels: [],
    });

    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [
        {
          id: "fake/default",
          model: "fake/default",
          displayName: "Fake Default",
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
        },
        {
          id: "fake/strong",
          model: "fake/strong",
          displayName: "Fake Strong",
          isDefault: false,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
        },
      ],
      selectedOnlyModels: [],
    });
  });

  it("advertises launch-time reasoning CLI levels on ACP-native models", async () => {
    const modelListId = sendRequest("model/list", {
      agent: {
        command: process.execPath,
        args: [FAKE_AGENT_PATH],
        envVars: { FAKE_ACP_MODELS_FIELD: "1" },
      },
      primaryModels: [],
      reasoningCli: {
        flag: "--reasoning-effort",
        supportedLevels: ["low", "medium", "high"],
        defaultLevel: "high",
      },
    });

    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [
        {
          id: "fake/default",
          defaultReasoningEffort: "high",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
        },
        {
          id: "fake/strong",
          defaultReasoningEffort: "high",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
        },
      ],
      selectedOnlyModels: [],
    });
  });

  it("authenticates before ACP-native model discovery", async () => {
    const modelListId = sendRequest("model/list", {
      agent: {
        command: process.execPath,
        args: [FAKE_AGENT_PATH],
        envVars: {
          FAKE_ACP_AUTH_METHODS: "cached_token",
          FAKE_ACP_MODEL_CONFIG: "1",
        },
      },
      primaryModels: [],
    });

    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [
        {
          id: "fake/default",
          model: "fake/default",
          displayName: "Fake Default",
        },
        {
          id: "fake/strong",
          model: "fake/strong",
          displayName: "Fake Strong",
        },
      ],
      selectedOnlyModels: [],
    });
  });

  it("probes per-model reasoning across large catalogs instead of falling back", async () => {
    const modelListId = sendRequest("model/list", {
      agent: {
        command: process.execPath,
        args: [FAKE_AGENT_PATH],
        envVars: {
          FAKE_ACP_MODEL_CONFIG: "1",
          FAKE_ACP_THOUGHT_LEVEL_CONFIG: "1",
          FAKE_ACP_MODEL_COUNT: "60",
        },
      },
      primaryModels: [],
    });

    const result = (await waitForResponse(modelListId)).result as {
      models: {
        id: string;
        supportedReasoningEfforts: { reasoningEffort: string }[];
      }[];
    };
    expect(result.models).toHaveLength(60);
    const lastGenerated = result.models.find(
      (model) => model.id === "fake/gen-59",
    );
    expect(lastGenerated?.supportedReasoningEfforts).toEqual([
      { reasoningEffort: "low", description: "low" },
      { reasoningEffort: "medium", description: "medium" },
      { reasoningEffort: "high", description: "high" },
    ]);
  });

  it("keeps ACP-native discovered models when per-model reasoning discovery errors", async () => {
    const modelListId = sendRequest("model/list", {
      agent: {
        command: process.execPath,
        args: [FAKE_AGENT_PATH],
        envVars: {
          FAKE_ACP_MODEL_CONFIG: "1",
          FAKE_ACP_THOUGHT_LEVEL_CONFIG: "1",
          FAKE_ACP_SET_CONFIG_MODEL_ERROR: "1",
        },
      },
      primaryModels: [],
    });

    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [
        {
          id: "fake/default",
          model: "fake/default",
          displayName: "Fake Default",
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
        },
        {
          id: "fake/strong",
          model: "fake/strong",
          displayName: "Fake Strong",
          isDefault: false,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
        },
      ],
      selectedOnlyModels: [],
    });
  });

  it("times out hung ACP-native discovery, kills the child, and falls back to the synthetic model", async () => {
    const signalFile = join(workspaceDir, "discovery-agent-signal.txt");
    const readyFile = join(workspaceDir, "discovery-agent-ready.txt");
    let modelListId: number;

    vi.useFakeTimers();
    try {
      modelListId = sendRequest("model/list", {
        agent: {
          command: process.execPath,
          args: [FAKE_AGENT_PATH],
          envVars: {
            FAKE_ACP_HANG_INITIALIZE: "1",
            FAKE_ACP_READY_FILE: readyFile,
            FAKE_ACP_SIGNAL_FILE: signalFile,
          },
        },
        primaryModels: [],
      });
      await waitForFileWithRealTimer(readyFile);
      await vi.advanceTimersByTimeAsync(30_000);
    } finally {
      vi.useRealTimers();
    }

    expect((await waitForResponse(modelListId!)).result).toMatchObject({
      models: [{ id: "acp-default", isDefault: true }],
      selectedOnlyModels: [],
    });
    await waitFor(
      () => (existsSync(signalFile) ? true : undefined),
      "discovery agent termination",
      5_000,
    );
  });

  it("serves ACP-native discovered models from cache within the TTL and re-discovers after it", async () => {
    const launchLog = join(workspaceDir, "discovery-launches.txt");
    const agent = {
      command: process.execPath,
      args: [FAKE_AGENT_PATH],
      envVars: { FAKE_ACP_MODEL_CONFIG: "1", FAKE_ACP_LAUNCH_LOG: launchLog },
    };
    const launchCount = () =>
      existsSync(launchLog)
        ? readFileSync(launchLog, "utf8").trim().split("\n").filter(Boolean)
            .length
        : 0;
    const listModels = async () =>
      (
        await waitForResponse(
          sendRequest("model/list", { agent, primaryModels: [] }),
        )
      ).result;

    // Fake only Date so real timers/I/O still drive the subprocess discovery
    // and the wait helpers; we advance the clock to cross the discovery TTL.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(1_000_000);
      await listModels();
      expect(launchCount()).toBe(1);

      // Within the 60s TTL: served from cache, no new discovery spawn.
      vi.setSystemTime(1_030_000);
      await listModels();
      expect(launchCount()).toBe(1);

      // Past the TTL: re-discovers, spawning the agent again.
      vi.setSystemTime(1_061_000);
      const refreshed = await listModels();
      expect(launchCount()).toBe(2);
      expect(refreshed).toMatchObject({
        models: [
          { id: "fake/default", isDefault: true },
          { id: "fake/strong", isDefault: false },
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the synthetic model when ACP-native session discovery has no model option", async () => {
    const modelListId = sendRequest("model/list", {
      agent: { command: process.execPath, args: [FAKE_AGENT_PATH] },
      primaryModels: [],
    });

    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [{ id: "acp-default", isDefault: true }],
      selectedOnlyModels: [],
    });
  });

  it("fails model/list with a clear error when the list command is missing", async () => {
    const failingId = sendRequest("model/list", {
      listCommand: {
        command: "/nonexistent/acp-model-lister",
        args: ["--list-models"],
      },
      primaryModels: [],
    });
    const failingResponse = await waitForResponse(failingId);
    expect(failingResponse.error?.message).toMatch(
      /spawn \/nonexistent\/acp-model-lister ENOENT/,
    );
  });

  it("fails model/list when the list command reports ACP auth is required", async () => {
    const authId = sendRequest("model/list", {
      listCommand: {
        command: process.execPath,
        args: [
          "-e",
          [
            "console.error(\"Error: Authentication required. Run 'agent login', pass --api-key/--auth-token, or set CURSOR_API_KEY/CURSOR_AUTH_TOKEN.\");",
            "process.exit(1);",
          ].join(""),
        ],
      },
      primaryModels: [],
    });

    const response = await waitForResponse(authId);
    expect(response.error?.message).toBe("ACP agent is not authenticated.");
  });

  it("falls back to the synthetic model when the list command prints no models", async () => {
    const emptyId = sendRequest("model/list", {
      listCommand: {
        command: process.execPath,
        args: ["-e", 'console.log("no model lines here")'],
      },
      primaryModels: [],
    });
    expect((await waitForResponse(emptyId)).result).toMatchObject({
      models: [{ id: "acp-default", isDefault: true }],
    });
  });

  it("keeps CLI reasoning on the resolved model variant instead of ACP config", async () => {
    chmodSync(FAKE_AGENT_PATH, 0o755);
    // Seed the bridge's catalog cache the way a picker would.
    const listCommand = {
      command: process.execPath,
      args: [
        "-e",
        'console.log("pinme-low - Pin Me Low\\npinme - Pin Me\\npinme-extra-high - Pin Me Extra High")',
      ],
    };
    await waitForResponse(
      sendRequest("model/list", { listCommand, primaryModels: [] }),
    );

    // The fake agent runs via its shebang so the bridge's leading
    // `--model <id>` lands in the agent's argv instead of node's.
    const { providerThreadId } = await startThread({
      agent: { command: FAKE_AGENT_PATH, args: [] },
      modelSelection: {
        listCommand,
        selectFlag: "--model",
        model: "pinme",
        reasoningLevel: "xhigh",
      },
    });
    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-argv", mentions: [] }],
    });
    await waitForTurnCompleted();
    expect(
      agentMessageTexts().some(
        (text) => text === "argv:--model pinme-extra-high",
      ),
    ).toBe(true);
  });

  it("spawns the agent through the sandbox launcher, its own flags intact", async () => {
    // The launcher confines a sandboxed ACP turn, and it goes on last: the
    // model flag belongs to the agent (`cursor-agent --model x acp`), so a
    // launcher folded into `agent.command` would have taken it for itself.
    chmodSync(FAKE_AGENT_PATH, 0o755);
    const launchLog = join(workspaceDir, "launched-through-sandbox.log");

    const { providerThreadId } = await startThread({
      agent: { command: FAKE_AGENT_PATH, args: ["acp"] },
      // Stands in for seatbelt or bwrap: a launcher that runs what follows it.
      // Set only here, so the file exists only if the launcher really ran.
      agentSandbox: {
        command: "/usr/bin/env",
        args: [`FAKE_ACP_LAUNCH_LOG=${launchLog}`],
      },
      modelSelection: {
        listCommand: { command: "/nonexistent/acp-model-lister", args: [] },
        selectFlag: "--model",
        model: "pinme",
      },
    });
    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-argv", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("argv:--model pinme acp");
    expect(readFileSync(launchLog, "utf8")).toContain("launch ");
  });

  it("hands the confined agent the environment its boundary depends on", async () => {
    // The launcher is only half of a network-confined turn: with the OS
    // refusing everything that leaves the machine, an agent that was never told
    // where the proxy is reaches nothing at all. So the environment travels
    // with the launcher, and this asserts it arrives in the agent's own
    // process rather than stopping at the bridge.
    chmodSync(FAKE_AGENT_PATH, 0o755);

    const { providerThreadId } = await startThread({
      agent: { command: FAKE_AGENT_PATH, args: ["acp"] },
      agentSandbox: {
        command: "/usr/bin/env",
        args: [],
        env: {
          HTTPS_PROXY: "http://patcher:tok@127.0.0.1:9",
          NO_PROXY: "localhost,127.0.0.1,::1",
        },
      },
    });
    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-proxy-env", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain(
      "proxy-env:http://patcher:tok@127.0.0.1:9 no:localhost,127.0.0.1,::1",
    );
  });

  it("puts its own tool port where a confined Linux turn can find it", async () => {
    // An agent's plugin tools dial a loopback port this process binds. Inside
    // a `--unshare-net` namespace that port does not exist, so the relay in
    // front of the agent mirrors whatever sockets the daemon left in this
    // directory — and the tool bridge's own port is not one the daemon can
    // know, because this process binds it when the session starts. So the
    // bridge drops a socket named for it here itself.
    chmodSync(FAKE_AGENT_PATH, 0o755);
    // Straight under the temp root, not under the workspace: a unix socket
    // path is capped at ~104 bytes by the kernel, and this suite's workspace
    // lives under a `mkdtemp` path that spends most of that on macOS. The
    // daemon's own directory is chosen the same way, for the same reason.
    const socketDir = mkdtempSync(join(tmpdir(), "p-sock-"));
    socketDirs.push(socketDir);

    const { providerThreadId } = await startThread({
      agent: { command: FAKE_AGENT_PATH, args: ["acp"] },
      agentSandbox: {
        command: "/usr/bin/env",
        args: [],
        loopbackSocketDir: socketDir,
      },
      dynamicTools: [
        {
          name: "update_environment_directory",
          description: "Move this thread to another environment directory.",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
    });

    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-mcp-server-config", mentions: [] }],
    });
    await waitForTurnCompleted();

    const configPrefix = "mcp-server-config:";
    const configText = agentMessageTexts().find((text) =>
      text.startsWith(configPrefix),
    );
    if (!configText) {
      throw new Error("Fake ACP agent did not report MCP server config");
    }
    const [mcpServerConfig] = JSON.parse(
      configText.slice(configPrefix.length),
    ) as { env: { name: string; value: string }[] }[];
    const port = mcpServerConfig?.env.find(
      ({ name }) => name === "PATCHER_ACP_DYNAMIC_TOOL_PORT",
    )?.value;

    // The socket has to be named for the very port the MCP server was told to
    // dial: the relay maps one to the other by name, so a mismatch here is a
    // tool bridge that is reachable from nowhere.
    expect(port).toBeDefined();
    expect(existsSync(join(socketDir, `${String(port)}.sock`))).toBe(true);
  });

  it("raises the unconfined-agent warning at session start", async () => {
    // The runtime sends this when a sandboxed turn's provider has declared no
    // state directories: confining it on a guess would stop it from starting,
    // and starting it quietly would present as a sandboxed turn and not be one.
    const { providerThreadId } = await startThread({
      agentSandboxWarning: "opencode runs unconfined for this turn.",
    });
    await stopThread(providerThreadId);

    expect(
      notifications("acp/warning").some(
        (message) =>
          (message.params as { summary?: string } | undefined)?.summary ===
          "opencode runs unconfined for this turn.",
      ),
    ).toBe(true);
  });

  it("launches ACP agents with a configured reasoning CLI flag", async () => {
    chmodSync(FAKE_AGENT_PATH, 0o755);

    const { providerThreadId } = await startThread({
      agent: { command: FAKE_AGENT_PATH, args: [] },
      launchReasoningLevel: "xhigh",
      reasoningCli: {
        flag: "--reasoning-effort",
        supportedLevels: ["low", "medium", "high"],
        levelValues: { xhigh: "high", max: "high" },
        defaultLevel: "high",
      },
    });
    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-argv", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(
      agentMessageTexts().some(
        (text) => text === "argv:--reasoning-effort high",
      ),
    ).toBe(true);
  });

  it("launches full-mode ACP agents with configured permission CLI args", async () => {
    chmodSync(FAKE_AGENT_PATH, 0o755);

    const { providerThreadId } = await startThread({
      agent: { command: FAKE_AGENT_PATH, args: ["agent", "stdio"] },
      permissionMode: "full",
      permissionCli: {
        full: ["--always-approve"],
        insertAfterArgs: 1,
      },
    });
    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-argv", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(
      agentMessageTexts().some(
        (text) => text === "argv:agent --always-approve stdio",
      ),
    ).toBe(true);
  });

  it("does not apply full-mode permission CLI args in workspace-write mode", async () => {
    chmodSync(FAKE_AGENT_PATH, 0o755);

    const { providerThreadId } = await startThread({
      agent: { command: FAKE_AGENT_PATH, args: [] },
      permissionMode: "accept-edits",
      permissionCli: {
        full: ["--always-approve"],
      },
    });
    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-argv", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("argv:");
  });

  it("uses modelCli only for model selection when reasoningCli owns effort", async () => {
    chmodSync(FAKE_AGENT_PATH, 0o755);
    const listCommand = {
      command: process.execPath,
      args: ["-e", 'console.log("pinme - Pin Me")'],
    };
    await waitForResponse(
      sendRequest("model/list", {
        listCommand,
        primaryModels: [],
        reasoningCli: {
          flag: "--reasoning-effort",
          supportedLevels: ["low", "medium", "high"],
        },
      }),
    );

    const { providerThreadId } = await startThread({
      agent: { command: FAKE_AGENT_PATH, args: [] },
      launchReasoningLevel: "max",
      reasoningCli: {
        flag: "--reasoning-effort",
        supportedLevels: ["low", "medium", "high"],
        levelValues: { max: "high" },
      },
      modelSelection: {
        listCommand,
        selectFlag: "--model",
        model: "pinme",
        reasoningLevel: "max",
      },
    });
    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-argv", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(
      agentMessageTexts().some(
        (text) => text === "argv:--model pinme --reasoning-effort high",
      ),
    ).toBe(true);
  });

  it("selects ACP-native models with session/set_config_option before the first prompt", async () => {
    const { providerThreadId } = await startThread({
      envVars: { FAKE_ACP_MODEL_CONFIG: "1" },
      modelSelection: { modelId: "fake/strong" },
    });

    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-selected-model", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("selected-model:fake/strong");
  });

  it("falls back to session/set_model when the model config option errors", async () => {
    const { providerThreadId } = await startThread({
      envVars: {
        FAKE_ACP_MODEL_CONFIG: "1",
        FAKE_ACP_SET_CONFIG_MODEL_ERROR: "1",
      },
      modelSelection: { modelId: "fake/strong" },
    });

    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-selected-model", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("selected-model:fake/strong");
  });

  it("selects ACP-native models from session models state", async () => {
    const { providerThreadId } = await startThread({
      envVars: { FAKE_ACP_MODELS_FIELD: "1" },
      modelSelection: { modelId: "fake/strong" },
    });

    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-selected-model", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("selected-model:fake/strong");
  });

  it("selects ACP-native reasoning with session/set_config_option before the first prompt", async () => {
    const { providerThreadId } = await startThread({
      envVars: {
        FAKE_ACP_MODEL_CONFIG: "1",
        FAKE_ACP_THOUGHT_LEVEL_CONFIG: "1",
      },
      modelSelection: { modelId: "fake/strong", reasoningLevel: "max" },
    });

    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-selected-effort", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("selected-effort:xhigh");
  });

  it("applies configured native reasoning when the ACP agent does not advertise thought_level", async () => {
    const { providerThreadId } = await startThread({
      envVars: {
        FAKE_ACP_MODEL_CONFIG: "1",
        FAKE_ACP_ACCEPT_NATIVE_REASONING: "1",
      },
      modelSelection: { modelId: "fake/strong", reasoningLevel: "max" },
      nativeReasoning: {
        configId: "reasoning_effort",
        supportedLevels: ["none", "low", "medium", "high", "xhigh", "max"],
        defaultLevel: "medium",
      },
    });

    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-selected-effort", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("selected-effort:max");
  });

  it("keeps ACP-native models without thought_level at the single managed level", async () => {
    const modelListId = sendRequest("model/list", {
      agent: {
        command: process.execPath,
        args: [FAKE_AGENT_PATH],
        envVars: { FAKE_ACP_MODEL_CONFIG: "1" },
      },
      primaryModels: [],
    });

    const response = await waitForResponse(modelListId);
    const models = (
      response.result as {
        models: {
          id: string;
          supportedReasoningEfforts: { reasoningEffort: string }[];
        }[];
      }
    ).models;
    expect(
      models.find((model) => model.id === "fake/strong")
        ?.supportedReasoningEfforts,
    ).toEqual([{ reasoningEffort: "medium", description: expect.any(String) }]);
  });

  it("keeps reasoning empty when an ACP-native model advertises only unmapped thought levels", async () => {
    const modelListId = sendRequest("model/list", {
      agent: {
        command: process.execPath,
        args: [FAKE_AGENT_PATH],
        envVars: {
          FAKE_ACP_MODEL_CONFIG: "1",
          FAKE_ACP_UNMAPPED_REASONING_CONFIG: "1",
        },
      },
      primaryModels: [],
    });

    const response = await waitForResponse(modelListId);
    const models = (
      response.result as {
        models: {
          id: string;
          supportedReasoningEfforts: { reasoningEffort: string }[];
        }[];
      }
    ).models;
    expect(
      models.find((model) => model.id === "fake/strong")
        ?.supportedReasoningEfforts,
    ).toEqual([]);
  });

  it("shows configured native reasoning for ACP-native models without thought_level", async () => {
    const modelListId = sendRequest("model/list", {
      agent: {
        command: process.execPath,
        args: [FAKE_AGENT_PATH],
        envVars: { FAKE_ACP_MODEL_CONFIG: "1" },
      },
      primaryModels: [],
      nativeReasoning: {
        configId: "reasoning_effort",
        supportedLevels: ["none", "low", "medium", "high", "xhigh", "max"],
        defaultLevel: "medium",
      },
    });

    const response = await waitForResponse(modelListId);
    const models = (
      response.result as {
        models: {
          id: string;
          supportedReasoningEfforts: { reasoningEffort: string }[];
          defaultReasoningEffort: string;
        }[];
      }
    ).models;
    const strong = models.find((model) => model.id === "fake/strong");
    expect(strong?.defaultReasoningEffort).toBe("medium");
    expect(strong?.supportedReasoningEfforts).toEqual([
      { reasoningEffort: "none", description: "No extended thinking" },
      { reasoningEffort: "low", description: "Low reasoning effort" },
      { reasoningEffort: "medium", description: "Medium reasoning effort" },
      { reasoningEffort: "high", description: "High reasoning effort" },
      { reasoningEffort: "xhigh", description: "Extra high reasoning effort" },
      { reasoningEffort: "max", description: "Maximum reasoning effort" },
    ]);
  });

  it("does not leak bridge-only Electron env to the spawned agent", async () => {
    vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
    const { providerThreadId } = await startThread();

    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [
        { type: "text", text: "echo-electron-run-as-node", mentions: [] },
      ],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("electron-run-as-node:missing");
  });

  it("preserves Electron Node mode for the dynamic-tool MCP process only", async () => {
    vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
    const { providerThreadId } = await startThread({
      dynamicTools: [
        {
          name: "update_environment_directory",
          description: "Move this thread to another environment directory.",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
    });

    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-mcp-server-config", mentions: [] }],
    });
    await waitForTurnCompleted();

    const configPrefix = "mcp-server-config:";
    const configText = agentMessageTexts().find((text) =>
      text.startsWith(configPrefix),
    );
    if (!configText) {
      throw new Error("Fake ACP agent did not report MCP server config");
    }
    const [mcpServerConfig] = JSON.parse(
      configText.slice(configPrefix.length),
    ) as { env: { name: string; value: string }[] }[];
    expect(
      mcpServerConfig?.env.find(({ name }) => name === "ELECTRON_RUN_AS_NODE")
        ?.value,
    ).toBe("1");

    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [
        { type: "text", text: "echo-electron-run-as-node", mentions: [] },
      ],
    });
    await waitFor(
      () =>
        agentMessageTexts().find(
          (text) => text === "electron-run-as-node:missing",
        ),
      "agent environment report",
    );
  });

  it("warns and launches the family id when a reasoning variant is missing", async () => {
    chmodSync(FAKE_AGENT_PATH, 0o755);
    const listCommand = {
      command: process.execPath,
      args: ["-e", 'console.log("solo-2 - Solo Two")'],
    };
    await waitForResponse(
      sendRequest("model/list", { listCommand, primaryModels: [] }),
    );

    const { providerThreadId } = await startThread({
      agent: { command: FAKE_AGENT_PATH, args: [] },
      modelSelection: {
        listCommand,
        selectFlag: "--model",
        model: "solo-2",
        reasoningLevel: "max",
      },
    });
    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-argv", mentions: [] }],
    });
    await waitForTurnCompleted();
    expect(
      agentMessageTexts().some((text) => text === "argv:--model solo-2"),
    ).toBe(true);
    const warning = notifications("acp/warning").at(-1);
    expect(warning?.params).toMatchObject({
      summary: expect.stringContaining("no max reasoning variant"),
    });
  });

  it("starts a session and runs a prompt turn end to end", async () => {
    const { patcherThreadId, providerThreadId } = await startThread();
    expect(providerThreadId).toMatch(/^fake-sess-\d+$/);

    const identity = notifications("thread/identity").at(-1);
    expect(identity?.params).toEqual({
      threadId: patcherThreadId,
      providerThreadId,
    });

    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "hello there", mentions: [] }],
    });
    await waitForResponse(turnId);

    const completed = await waitForTurnCompleted();
    expect(completed.params).toEqual({
      threadId: patcherThreadId,
      stopReason: "end_turn",
    });
    expect(notifications("acp/turn/started")).toHaveLength(1);
    expect(agentMessageTexts()).toContain("echo:hello there");
  });

  it("runs manual compaction as a provider-local maintenance prompt", async () => {
    const promptLog = join(workspaceDir, "prompt-log.jsonl");
    const { providerThreadId } = await startThread({
      instructions: "Be terse.",
      envVars: { FAKE_ACP_PROMPT_LOG: promptLog },
    });

    const compactId = sendRequest("thread/compact", {
      threadId: providerThreadId,
    });
    const compactResponse = await waitForResponse(compactId);
    expect(compactResponse.error).toBeUndefined();
    const completed = await waitForCompactionCompleted();
    expect(output.messages.indexOf(compactResponse)).toBeLessThan(
      output.messages.indexOf(completed),
    );
    expect(notifications("acp/turn/started")).toHaveLength(0);
    expect(notifications("acp/turn/completed")).toHaveLength(0);
    expect(notifications("acp/compaction/started")).toEqual([
      expect.objectContaining({
        params: { threadId: expect.any(String) },
      }),
    ]);
    expect(notifications("acp/compaction/completed")).toEqual([
      expect.objectContaining({
        params: { threadId: expect.any(String), status: "completed" },
      }),
    ]);
    expect(
      readFileSync(promptLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual(["/compact"]);

    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "hi", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();
    expect(agentMessageTexts().at(-1)).toBe(
      "echo:<system_instructions>\nBe terse.\n</system_instructions>\nhi",
    );
  });

  it("reports a rejected maintenance prompt through the compaction lifecycle", async () => {
    const { providerThreadId } = await startThread({
      envVars: { FAKE_ACP_PROMPT_ERROR: "1" },
    });

    const compactId = sendRequest("thread/compact", {
      threadId: providerThreadId,
    });
    const compactResponse = await waitForResponse(compactId);
    expect(compactResponse.error).toBeUndefined();

    const completed = await waitForCompactionCompleted();
    expect(completed.params).toEqual({
      threadId: expect.any(String),
      status: "failed",
      error: expect.stringContaining("Fake prompt failure"),
    });
    expect(output.messages.indexOf(compactResponse)).toBeLessThan(
      output.messages.indexOf(completed),
    );
  });

  it("does not report an ACP refusal as successful compaction", async () => {
    const { providerThreadId } = await startThread({
      envVars: { FAKE_ACP_COMPACT_STOP_REASON: "refusal" },
    });

    const compactId = sendRequest("thread/compact", {
      threadId: providerThreadId,
    });
    await waitForResponse(compactId);

    const completed = await waitForCompactionCompleted();
    expect(completed.params).toEqual({
      threadId: expect.any(String),
      status: "failed",
      error: "Agent stopped compaction: refusal",
    });
  });

  it("authenticates ACP sessions with cached tokens when advertised", async () => {
    const { providerThreadId } = await startThread({
      envVars: { FAKE_ACP_AUTH_METHODS: "cached_token" },
    });

    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-auth-method", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("auth-method:cached_token");
  });

  it("prefers xAI API-key auth when XAI_API_KEY is available", async () => {
    const { providerThreadId } = await startThread({
      envVars: {
        FAKE_ACP_AUTH_METHODS: "cached_token,xai.api_key",
        XAI_API_KEY: "xai-test-key",
      },
    });

    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-auth-method", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("auth-method:xai.api_key");
  });

  it("lets agents surface their own error for unsupported advertised auth methods", async () => {
    nextThreadSerial += 1;
    const id = sendRequest("thread/start", {
      threadId: `thread-${nextThreadSerial}`,
      cwd: workspaceDir,
      agent: {
        command: process.execPath,
        args: [FAKE_AGENT_PATH],
      },
      permissionMode: "full",
      permissionEscalation: null,
      workspaceWriteRoots: [workspaceDir],
      envVars: { FAKE_ACP_AUTH_METHODS: "agent.login" },
    });
    const response = await waitForResponse(id);

    expect(response.error?.message).toContain("Authentication required");
    expect(response.error?.message).not.toContain("does not support");
  });

  it("passes dynamic tools to ACP sessions as an MCP server", async () => {
    const { providerThreadId } = await startThread({
      dynamicTools: [
        {
          name: "update_environment_directory",
          description: "Move this thread to another environment directory.",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
    });

    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-mcp-servers", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain(
      `mcp-servers:${ACP_BRIDGE_MCP_SERVER_NAME}`,
    );
  });

  it("forwards ACP dynamic tool calls through the runtime tool-call contract", async () => {
    const { patcherThreadId, providerThreadId } = await startThread({
      dynamicTools: [
        {
          name: "update_environment_directory",
          description: "Move this thread to another environment directory.",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
    });

    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-mcp-server-config", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    const configPrefix = "mcp-server-config:";
    const configText = agentMessageTexts().find((text) =>
      text.startsWith(configPrefix),
    );
    if (!configText) {
      throw new Error("Fake ACP agent did not report MCP server config");
    }
    const [mcpServerConfig] = JSON.parse(
      configText.slice(configPrefix.length),
    ) as { env: { name: string; value: string }[]; name: string }[];
    if (!mcpServerConfig) {
      throw new Error("Fake ACP agent reported no MCP server config");
    }
    expect(mcpServerConfig?.name).toBe(ACP_BRIDGE_MCP_SERVER_NAME);
    const env = new Map(
      mcpServerConfig.env.map(({ name, value }) => [name, value]),
    );
    const host = env.get("PATCHER_ACP_DYNAMIC_TOOL_HOST");
    const port = Number(env.get("PATCHER_ACP_DYNAMIC_TOOL_PORT"));
    const threadId = env.get("PATCHER_ACP_DYNAMIC_TOOL_THREAD_ID");
    const token = env.get("PATCHER_ACP_DYNAMIC_TOOL_TOKEN");
    if (!host || !Number.isInteger(port) || !threadId || !token) {
      throw new Error("MCP server config is missing dynamic tool bridge env");
    }

    const bridgeCall = callDynamicToolBridge({
      callId: "test-dynamic-tool-call",
      host,
      port,
      threadId,
      token,
      tool: "update_environment_directory",
      toolArguments: { path: "/tmp/next-worktree" },
    });
    const forwarded = await waitFor(
      () =>
        output.messages.find(
          (message) =>
            message.method === "item/tool/call" && message.id !== undefined,
        ),
      "forwarded dynamic tool call",
    );
    expect(forwarded.params).toMatchObject({
      arguments: { path: "/tmp/next-worktree" },
      providerThreadId,
      threadId: patcherThreadId,
      tool: "update_environment_directory",
      turnId: null,
    });

    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: forwarded.id,
        result: {
          success: true,
          contentItems: [
            { type: "inputText", text: "environment directory updated" },
          ],
        },
      }),
    );

    await expect(bridgeCall).resolves.toEqual({
      content: "environment directory updated",
      isError: false,
      ok: true,
    });
  });

  it("prepends instructions to the first prompt only", async () => {
    const { providerThreadId } = await startThread({
      instructions: "Be terse.",
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "hi", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    const texts = agentMessageTexts();
    expect(texts.at(-1)).toBe(
      "echo:<system_instructions>\nBe terse.\n</system_instructions>\nhi",
    );
  });

  it("auto-allows permission requests in full mode", async () => {
    const { providerThreadId } = await startThread({ permissionMode: "full" });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "request-permission", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(notifications("acp/permission/request")).toHaveLength(0);
    expect(agentMessageTexts()).toContain("permission:yes");
  });

  it("forwards permission requests to the runtime in ask mode", async () => {
    const { patcherThreadId, providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "request-permission", mentions: [] }],
    });
    await waitForResponse(turnId);

    const forwarded = await waitFor(
      () =>
        output.messages.find(
          (message) =>
            message.method === "acp/permission/request" &&
            message.id !== undefined,
        ),
      "forwarded permission request",
    );
    expect(forwarded.params).toMatchObject({
      threadId: patcherThreadId,
      providerThreadId,
      turnId: null,
      toolCall: {
        toolCallId: "perm-tool-1",
        kind: "execute",
        command: "rm -rf /tmp/scratch",
      },
    });

    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: forwarded.id,
        result: { decision: "deny" },
      }),
    );

    await waitForTurnCompleted();
    expect(agentMessageTexts()).toContain("permission:no");
  });

  it("answers session-grant decisions with the allow_always option", async () => {
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "request-permission", mentions: [] }],
    });
    await waitForResponse(turnId);
    const forwarded = await waitFor(
      () =>
        output.messages.find(
          (message) =>
            message.method === "acp/permission/request" &&
            message.id !== undefined,
        ),
      "forwarded permission request",
    );
    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: forwarded.id,
        result: { decision: "allow_for_session" },
      }),
    );
    await waitForTurnCompleted();
    expect(agentMessageTexts()).toContain("permission:always");
  });

  it("performs client fs writes inside the workspace and reports them", async () => {
    const targetPath = join(workspaceDir, "agent-output.txt");
    const { patcherThreadId, providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      envVars: { FAKE_ACP_WRITE_PATH: targetPath },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "write-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("write:ok");
    expect(readFileSync(targetPath, "utf8")).toBe("hello from agent\n");
    const fsWrite = notifications("acp/fs/write").at(-1);
    expect(fsWrite?.params).toMatchObject({
      threadId: patcherThreadId,
      path: targetPath,
      kind: "add",
    });
  });

  it("denies client fs writes outside the workspace in accept-edits mode", async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "patcher-acp-outside-"));
    const targetPath = join(outsideDir, "outside.txt");
    try {
      const { providerThreadId } = await startThread({
        permissionMode: "accept-edits",
        permissionEscalation: "ask",
        envVars: { FAKE_ACP_WRITE_PATH: targetPath },
      });
      const turnId = sendRequest("turn/start", {
        threadId: providerThreadId,
        input: [{ type: "text", text: "write-file", mentions: [] }],
      });
      await waitForResponse(turnId);
      await waitForTurnCompleted();

      expect(agentMessageStartingWith("write:denied:")).toContain(
        "File writes outside the workspace are denied",
      );
      expect(existsSync(targetPath)).toBe(false);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("refuses a client fs read of Patcher's own credential file", async () => {
    // The agent's own process is denied this file by the sandbox the daemon
    // builds; this process is not in that sandbox, so without the same list
    // here the agent just asks the bridge to read it instead.
    const dataDir = mkdtempSync(join(tmpdir(), "patcher-acp-data-"));
    const appKeyPath = join(dataDir, "app-api-key");
    writeFileSync(appKeyPath, "patcher-app-key-secret\n", "utf8");
    try {
      const { providerThreadId } = await startThread({
        permissionMode: "accept-edits",
        permissionEscalation: "ask",
        protectedCredentialPaths: [appKeyPath],
        envVars: { FAKE_ACP_READ_PATH: appKeyPath },
      });
      const turnId = sendRequest("turn/start", {
        threadId: providerThreadId,
        input: [{ type: "text", text: "read-file", mentions: [] }],
      });
      await waitForResponse(turnId);
      await waitForTurnCompleted();

      expect(agentMessageStartingWith("read:denied:")).toContain(
        "credential files",
      );
      expect(agentMessageTexts().join("\n")).not.toContain(
        "patcher-app-key-secret",
      );
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("refuses a client fs read that lands on a credential file through a link", async () => {
    // A rule about a path is a rule about where the path lands, or it is a rule
    // about nothing: an ordinary-looking name in the workspace pointing at the
    // app key is the whole of the bypass.
    const dataDir = mkdtempSync(join(tmpdir(), "patcher-acp-data-"));
    const appKeyPath = join(dataDir, "app-api-key");
    writeFileSync(appKeyPath, "patcher-app-key-secret\n", "utf8");
    const linkPath = join(workspaceDir, "notes.txt");
    symlinkSync(appKeyPath, linkPath);
    try {
      const { providerThreadId } = await startThread({
        permissionMode: "accept-edits",
        permissionEscalation: "ask",
        protectedCredentialPaths: [appKeyPath],
        envVars: { FAKE_ACP_READ_PATH: linkPath },
      });
      const turnId = sendRequest("turn/start", {
        threadId: providerThreadId,
        input: [{ type: "text", text: "read-file", mentions: [] }],
      });
      await waitForResponse(turnId);
      await waitForTurnCompleted();

      expect(agentMessageStartingWith("read:denied:")).toContain(
        "credential files",
      );
      expect(agentMessageTexts().join("\n")).not.toContain(
        "patcher-app-key-secret",
      );
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("serves a client fs read outside the workspace, as the sandbox does", async () => {
    // Deliberate, and the reason is that the alternative buys nothing: the
    // agent's sandbox allows this read, so a bridge that refused it would gate
    // the polite path while the agent's own tools opened the same file.
    const outsideDir = mkdtempSync(join(tmpdir(), "patcher-acp-outside-"));
    const notePath = join(outsideDir, "note.txt");
    writeFileSync(notePath, "a note outside the workspace\n", "utf8");
    try {
      const { providerThreadId } = await startThread({
        permissionMode: "accept-edits",
        permissionEscalation: "ask",
        protectedCredentialPaths: [join(outsideDir, "app-api-key")],
        envVars: { FAKE_ACP_READ_PATH: notePath },
      });
      const turnId = sendRequest("turn/start", {
        threadId: providerThreadId,
        input: [{ type: "text", text: "read-file", mentions: [] }],
      });
      await waitForResponse(turnId);
      await waitForTurnCompleted();

      expect(agentMessageStartingWith("read:ok:")).toContain(
        "a note outside the workspace",
      );
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("leaves a Full Access turn's reads alone, there being no sandbox to mirror", async () => {
    // Full Access is the mode that asks for no boundary, and these lists are a
    // mirror of one — the same line `runtime-manager.ts` draws where it builds
    // the credential list. A turn at Full Access reads this file with its own
    // tools anyway.
    const dataDir = mkdtempSync(join(tmpdir(), "patcher-acp-data-"));
    const appKeyPath = join(dataDir, "app-api-key");
    writeFileSync(appKeyPath, "patcher-app-key-secret\n", "utf8");
    try {
      const { providerThreadId } = await startThread({
        permissionMode: "full",
        protectedCredentialPaths: [appKeyPath],
        envVars: { FAKE_ACP_READ_PATH: appKeyPath },
      });
      const turnId = sendRequest("turn/start", {
        threadId: providerThreadId,
        input: [{ type: "text", text: "read-file", mentions: [] }],
      });
      await waitForResponse(turnId);
      await waitForTurnCompleted();

      expect(agentMessageStartingWith("read:ok:")).toContain(
        "patcher-app-key-secret",
      );
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("refuses a client fs write to a repository file git executes", async () => {
    // Inside the workspace, so the write-roots check has nothing to say about
    // it — and git reads it in the daemon, outside the sandbox.
    const gitDir = join(workspaceDir, ".git");
    mkdirSync(gitDir, { recursive: true });
    const configPath = join(gitDir, "config");
    writeFileSync(configPath, "[core]\n", "utf8");
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      protectedRepositoryPaths: [configPath],
      envVars: { FAKE_ACP_WRITE_PATH: configPath },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "write-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageStartingWith("write:denied:")).toContain(
      "git runs what this file configures",
    );
    expect(readFileSync(configPath, "utf8")).toBe("[core]\n");
  });

  it("refuses a client fs write inside a protected directory", async () => {
    // `hooks` is on the list as a directory, and a rule about a directory that
    // let its children through would be no rule at all.
    const hooksDir = join(workspaceDir, ".git", "hooks");
    mkdirSync(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, "pre-commit");
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      protectedRepositoryPaths: [hooksDir],
      envVars: { FAKE_ACP_WRITE_PATH: hookPath },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "write-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageStartingWith("write:denied:")).toContain(
      "git runs what this file configures",
    );
    expect(existsSync(hookPath)).toBe(false);
  });

  it("follows a link before the `..` after it, as the filesystem does", async () => {
    // `<ws>/link/../note.txt` is not `<ws>/note.txt`: the lookup follows `link`
    // first, so the `..` is the parent of what it points at. `path.resolve` and
    // Node's own `realpath` both collapse that `..` as text — measured — and
    // only `realpath.native` asks the OS. The handler acts on the resolved
    // path, so getting this wrong reads a file nobody asked for.
    const outsideDir = mkdtempSync(join(tmpdir(), "patcher-acp-outside-"));
    mkdirSync(join(outsideDir, "dir"), { recursive: true });
    writeFileSync(join(outsideDir, "note.txt"), "beside the target\n", "utf8");
    writeFileSync(join(workspaceDir, "note.txt"), "beside the link\n", "utf8");
    symlinkSync(join(outsideDir, "dir"), join(workspaceDir, "link"));
    try {
      const { providerThreadId } = await startThread({
        permissionMode: "accept-edits",
        permissionEscalation: "ask",
        envVars: {
          FAKE_ACP_READ_PATH: pathKeepingDotDot(
            workspaceDir,
            "link",
            "..",
            "note.txt",
          ),
        },
      });
      const turnId = sendRequest("turn/start", {
        threadId: providerThreadId,
        input: [{ type: "text", text: "read-file", mentions: [] }],
      });
      await waitForResponse(turnId);
      await waitForTurnCompleted();

      expect(agentMessageStartingWith("read:ok:")).toContain(
        "beside the target",
      );
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("refuses a read whose `..` sits behind a component that is not there", async () => {
    // The kernel walks the path and fails on `missing` — measured, ENOENT.
    // Putting the peeled tail back would collapse the `..` and answer with
    // `<ws>/note.txt`, a file that does exist and that nobody asked for.
    writeFileSync(join(workspaceDir, "note.txt"), "beside nothing\n", "utf8");
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      envVars: {
        FAKE_ACP_READ_PATH: pathKeepingDotDot(
          workspaceDir,
          "missing",
          "..",
          "note.txt",
        ),
      },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "read-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageStartingWith("read:denied:")).toContain(
      "the path names no file",
    );
    expect(agentMessageTexts().join("\n")).not.toContain("beside nothing");
  });

  it("refuses a write whose `..` sits behind a component that is not there", async () => {
    // Same path shape on the write side, where inventing an answer would have
    // created a file at a path the request never named.
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      envVars: {
        FAKE_ACP_WRITE_PATH: pathKeepingDotDot(
          workspaceDir,
          "missing",
          "..",
          "out.txt",
        ),
      },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "write-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageStartingWith("write:denied:")).toContain(
      "the path names no file",
    );
    expect(existsSync(join(workspaceDir, "out.txt"))).toBe(false);
  });

  it("denies a write whose `..` steps out of the workspace behind a link", async () => {
    // The same resolution seen from the policy's side: collapsed as text this
    // path looks like an ordinary file in the workspace, and the write would
    // have gone to one.
    const outsideDir = mkdtempSync(join(tmpdir(), "patcher-acp-outside-"));
    mkdirSync(join(outsideDir, "dir"), { recursive: true });
    symlinkSync(join(outsideDir, "dir"), join(workspaceDir, "link"));
    try {
      const { providerThreadId } = await startThread({
        permissionMode: "accept-edits",
        permissionEscalation: "ask",
        envVars: {
          FAKE_ACP_WRITE_PATH: pathKeepingDotDot(
            workspaceDir,
            "link",
            "..",
            "out.txt",
          ),
        },
      });
      const turnId = sendRequest("turn/start", {
        threadId: providerThreadId,
        input: [{ type: "text", text: "write-file", mentions: [] }],
      });
      await waitForResponse(turnId);
      await waitForTurnCompleted();

      expect(agentMessageStartingWith("write:denied:")).toContain(
        "File writes outside the workspace are denied",
      );
      expect(existsSync(join(outsideDir, "out.txt"))).toBe(false);
      expect(existsSync(join(workspaceDir, "out.txt"))).toBe(false);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("refuses a client fs write that leaves the workspace through a link", async () => {
    // The write-roots check compared the path it was handed: a link in the
    // workspace pointing anywhere made every root in the list an opinion about
    // the string rather than about the file.
    const outsideDir = mkdtempSync(join(tmpdir(), "patcher-acp-outside-"));
    symlinkSync(outsideDir, join(workspaceDir, "escape"));
    const targetPath = join(workspaceDir, "escape", "outside.txt");
    try {
      const { providerThreadId } = await startThread({
        permissionMode: "accept-edits",
        permissionEscalation: "ask",
        envVars: { FAKE_ACP_WRITE_PATH: targetPath },
      });
      const turnId = sendRequest("turn/start", {
        threadId: providerThreadId,
        input: [{ type: "text", text: "write-file", mentions: [] }],
      });
      await waitForResponse(turnId);
      await waitForTurnCompleted();

      expect(agentMessageStartingWith("write:denied:")).toContain(
        "File writes outside the workspace are denied",
      );
      expect(existsSync(join(outsideDir, "outside.txt"))).toBe(false);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("refuses a read whose `..` follows a file, as the filesystem does", async () => {
    // A lookup fails at `note.txt` — ENOTDIR, measured — because a `..` may only
    // follow a directory. Darwin's `realpath(3)` does not: handed the whole
    // path it answered `<ws>/other.txt`, a second file that exists and that
    // nobody asked for, which is why the resolver walks a component at a time.
    writeFileSync(join(workspaceDir, "note.txt"), "the file named\n", "utf8");
    writeFileSync(
      join(workspaceDir, "other.txt"),
      "the one beside it\n",
      "utf8",
    );
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      envVars: {
        FAKE_ACP_READ_PATH: pathKeepingDotDot(
          workspaceDir,
          "note.txt",
          "..",
          "other.txt",
        ),
      },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "read-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageStartingWith("read:denied:")).toContain(
      "the path names no file",
    );
    expect(agentMessageTexts().join("\n")).not.toContain("the one beside it");
  });

  it("refuses a read of a file asked for with a trailing slash", async () => {
    // The slash says the name is a directory, and `note.txt` is not one: the
    // read is ENOTDIR on both platforms. `realpath(3)` on macOS answers the
    // file anyway, and the peeling this replaced dropped the slash on Linux,
    // so both would have served a file the request did not name.
    writeFileSync(join(workspaceDir, "note.txt"), "behind the slash\n", "utf8");
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      envVars: {
        FAKE_ACP_READ_PATH: `${join(workspaceDir, "note.txt")}${sep}`,
      },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "read-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageStartingWith("read:denied:")).toContain(
      "the path names no file",
    );
    expect(agentMessageTexts().join("\n")).not.toContain("behind the slash");
  });

  it("refuses a write to a file asked for with a trailing slash", async () => {
    // The same shape where the cost is the file's contents rather than a read:
    // the kernel refuses this write, so answering it would overwrite a file on
    // a request the filesystem would have turned down.
    writeFileSync(join(workspaceDir, "note.txt"), "kept as it was\n", "utf8");
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      envVars: {
        FAKE_ACP_WRITE_PATH: `${join(workspaceDir, "note.txt")}${sep}`,
      },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "write-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageStartingWith("write:denied:")).toContain(
      "the path names no file",
    );
    expect(readFileSync(join(workspaceDir, "note.txt"), "utf8")).toBe(
      "kept as it was\n",
    );
  });

  it("denies a write through a link whose target does not exist yet", async () => {
    // `realpath(3)` fails on a link that leads nowhere, and a name that fails
    // to resolve is taken here for a file about to be created — so this link
    // read as an ordinary workspace file, passed the write roots, and the write
    // created the outside target. Measured before the resolver followed it.
    const outsideDir = mkdtempSync(join(tmpdir(), "patcher-acp-outside-"));
    const outsideTarget = join(outsideDir, "created-by-agent.txt");
    symlinkSync(outsideTarget, join(workspaceDir, "dangling"));
    try {
      const { providerThreadId } = await startThread({
        permissionMode: "accept-edits",
        permissionEscalation: "ask",
        envVars: { FAKE_ACP_WRITE_PATH: join(workspaceDir, "dangling") },
      });
      const turnId = sendRequest("turn/start", {
        threadId: providerThreadId,
        input: [{ type: "text", text: "write-file", mentions: [] }],
      });
      await waitForResponse(turnId);
      await waitForTurnCompleted();

      expect(agentMessageStartingWith("write:denied:")).toContain(
        "File writes outside the workspace are denied",
      );
      expect(existsSync(outsideTarget)).toBe(false);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("writes through a link to a workspace file that is not there yet", async () => {
    // The other half of following one: the link lands inside the workspace, so
    // the write is allowed and goes where the kernel would have put it. Without
    // this the fix above could refuse every unresolved link and still pass.
    symlinkSync(join(workspaceDir, "made.txt"), join(workspaceDir, "pending"));
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      envVars: { FAKE_ACP_WRITE_PATH: join(workspaceDir, "pending") },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "write-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("write:ok");
    expect(readFileSync(join(workspaceDir, "made.txt"), "utf8")).toBe(
      "hello from agent\n",
    );
  });

  it("writes a file whose directories the workspace does not have yet", async () => {
    // Why the walk keeps names it cannot resolve rather than refusing them: a
    // write creates the file and the directories above it, so `fresh/nested`
    // not being there is the request, not a reason to turn it down.
    const targetPath = join(workspaceDir, "fresh", "nested", "out.txt");
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      envVars: { FAKE_ACP_WRITE_PATH: targetPath },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "write-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("write:ok");
    expect(readFileSync(targetPath, "utf8")).toBe("hello from agent\n");
  });

  it("denies a write to a directory whose name only starts with the workspace's", async () => {
    // `<ws>-evil` is not inside `<ws>`, and only a comparison on path segments
    // says so — one on the string sees the root as a prefix and lets the write
    // out. The sandbox these rules mirror made that mistake once, in `isInside`
    // in `terminals/terminal-sandbox.ts`, and left a whole workspace open.
    const siblingDir = `${workspaceDir}-evil`;
    mkdirSync(siblingDir, { recursive: true });
    try {
      const { providerThreadId } = await startThread({
        permissionMode: "accept-edits",
        permissionEscalation: "ask",
        envVars: { FAKE_ACP_WRITE_PATH: join(siblingDir, "out.txt") },
      });
      const turnId = sendRequest("turn/start", {
        threadId: providerThreadId,
        input: [{ type: "text", text: "write-file", mentions: [] }],
      });
      await waitForResponse(turnId);
      await waitForTurnCompleted();

      expect(agentMessageStartingWith("write:denied:")).toContain(
        "File writes outside the workspace are denied",
      );
      expect(existsSync(join(siblingDir, "out.txt"))).toBe(false);
    } finally {
      rmSync(siblingDir, { recursive: true, force: true });
    }
  });

  it("refuses a read through a link whose target steps past a file", async () => {
    // A link's target is a path in its own right. `note.txt/../other.txt` is
    // ENOTDIR to open — measured, on both platforms — and `realpath(3)` asked
    // about the link answered `<ws>/other.txt`, because it resolves the target
    // instead of walking it. The handler would have served that second file.
    writeFileSync(join(workspaceDir, "note.txt"), "the file named\n", "utf8");
    writeFileSync(
      join(workspaceDir, "other.txt"),
      "the one beside it\n",
      "utf8",
    );
    symlinkSync("note.txt/../other.txt", join(workspaceDir, "through-a-file"));
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      envVars: {
        FAKE_ACP_READ_PATH: join(workspaceDir, "through-a-file"),
      },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "read-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageStartingWith("read:denied:")).toContain(
      "the path names no file",
    );
    expect(agentMessageTexts().join("\n")).not.toContain("the one beside it");
  });

  it("refuses a write through a link whose target steps past a missing name", async () => {
    // The same shape with the `..` behind a name that is not there: ENOENT to
    // open. Joining the target onto the prefix collapses that `..` as text
    // before the walk sees it, and the write then lands on `other.txt`.
    writeFileSync(join(workspaceDir, "other.txt"), "left alone\n", "utf8");
    symlinkSync("missing/../other.txt", join(workspaceDir, "through-nothing"));
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      envVars: {
        FAKE_ACP_WRITE_PATH: join(workspaceDir, "through-nothing"),
      },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "write-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageStartingWith("write:denied:")).toContain(
      "the path names no file",
    );
    expect(readFileSync(join(workspaceDir, "other.txt"), "utf8")).toBe(
      "left alone\n",
    );
  });

  it("writes a file whose path carries an extra separator or a dot", async () => {
    // `fresh//out.txt` and `fresh/./out.txt` name the same file as
    // `fresh/out.txt`, and the handler creates the directories above it — so
    // both write, measured, on both platforms. A walk that asked for a
    // directory at every punctuation mark turned a supported write down.
    const targetPath = pathKeepingDotDot(workspaceDir, "fresh", "", "out.txt");
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      envVars: { FAKE_ACP_WRITE_PATH: targetPath },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "write-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("write:ok");
    expect(readFileSync(join(workspaceDir, "fresh", "out.txt"), "utf8")).toBe(
      "hello from agent\n",
    );
  });

  it("refuses a write to a directory that is not there", async () => {
    // The trailing slash names a directory, and the write roots do not make one
    // out of thin air: `<ws>/fresh/` is ENOENT to open on macOS and EISDIR on
    // Linux, measured, where `<ws>/fresh` alone would have been a file to make.
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      envVars: {
        FAKE_ACP_WRITE_PATH: `${join(workspaceDir, "fresh")}${sep}`,
      },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "write-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageStartingWith("write:denied:")).toContain(
      "the path names no file",
    );
    expect(existsSync(join(workspaceDir, "fresh"))).toBe(false);
  });

  it("refuses a path that walks through more links than a lookup would", async () => {
    // A lookup counts every link it follows, wherever in the path it sits: 60
    // of them in separate components, each pointing at `.`, is ELOOP on both
    // platforms — measured. A budget copied into each link target instead of
    // shared across the walk let this reach the file, and the handler would
    // have read it, since it acts on the resolved path and never on this one.
    writeFileSync(join(workspaceDir, "note.txt"), "past sixty links\n", "utf8");
    const links: string[] = [];
    for (let index = 0; index < 60; index += 1) {
      const name = `l${index}`;
      symlinkSync(".", join(workspaceDir, name));
      links.push(name);
    }
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      envVars: {
        FAKE_ACP_READ_PATH: join(workspaceDir, ...links, "note.txt"),
      },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "read-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageStartingWith("read:denied:")).toContain(
      "the path names no file",
    );
    expect(agentMessageTexts().join("\n")).not.toContain("past sixty links");
  });

  it("refuses a write through a link whose target names a directory", async () => {
    // The link's target is a path of its own, and `missing/` names a directory
    // there is none of: ENOENT to open on macOS, EISDIR on Linux, measured —
    // while `missing` alone is a file the write would create. The request ends
    // in the link's own name, so only a check inside the walk sees the slash.
    symlinkSync("missing/", join(workspaceDir, "to-a-directory"));
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      envVars: {
        FAKE_ACP_WRITE_PATH: join(workspaceDir, "to-a-directory"),
      },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "write-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageStartingWith("write:denied:")).toContain(
      "the path names no file",
    );
    expect(existsSync(join(workspaceDir, "missing"))).toBe(false);
  });

  it("chains steer input onto the active turn", async () => {
    const { providerThreadId } = await startThread();
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "slow first", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitFor(
      () =>
        agentMessageTexts().includes("echo:slow first") ? true : undefined,
      "first prompt echo",
    );

    const steerId = sendRequest("turn/steer", {
      threadId: providerThreadId,
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "steered", mentions: [] }],
    });
    await waitForResponse(steerId);

    await waitForTurnCompleted();
    expect(agentMessageTexts()).toContain("echo:steered");
    // One Patcher turn spans both prompts.
    expect(notifications("acp/turn/started")).toHaveLength(1);
    expect(notifications("acp/turn/completed")).toHaveLength(1);
  });

  it("rejects steers when no turn is active", async () => {
    const { providerThreadId } = await startThread();
    const steerId = sendRequest("turn/steer", {
      threadId: providerThreadId,
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "late", mentions: [] }],
    });
    const response = await waitForResponse(steerId);
    expect(response.error?.message).toMatch(/No active turn/);
  });

  it("cancels the active turn on thread/stop", async () => {
    const { patcherThreadId, providerThreadId } = await startThread();
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "hang", mentions: [] }],
    });
    await waitForResponse(turnId);

    const stopId = sendRequest("thread/stop", { threadId: providerThreadId });
    const stopResponse = await waitForResponse(stopId);
    expect(stopResponse.result).toEqual({ ok: true });

    const completed = await waitForTurnCompleted();
    expect(completed.params).toEqual({
      threadId: patcherThreadId,
      stopReason: "cancelled",
    });
    startedProviderThreadIds.pop();
  });

  it("resumes via session/load when the agent supports it", async () => {
    const first = await startThread({
      envVars: { FAKE_ACP_LOAD_SESSION: "1" },
    });
    await stopThread(first.providerThreadId);
    startedProviderThreadIds.pop();

    const resumeId = sendRequest("thread/resume", {
      threadId: first.patcherThreadId,
      providerThreadId: first.providerThreadId,
      cwd: workspaceDir,
      agent: { command: process.execPath, args: [FAKE_AGENT_PATH] },
      permissionMode: "full",
      permissionEscalation: null,
      workspaceWriteRoots: [workspaceDir],
      envVars: { FAKE_ACP_LOAD_SESSION: "1" },
    });
    const response = await waitForResponse(resumeId);
    expect(response.result).toEqual({
      providerThreadId: first.providerThreadId,
    });
    expect(notifications("acp/warning")).toHaveLength(0);
    startedProviderThreadIds.push(first.providerThreadId);
  });

  it("forwards context usage reported during session/load", async () => {
    const first = await startThread({
      envVars: { FAKE_ACP_LOAD_SESSION: "1" },
    });
    await stopThread(first.providerThreadId);
    startedProviderThreadIds.pop();

    const resumeId = sendRequest("thread/resume", {
      threadId: first.patcherThreadId,
      providerThreadId: first.providerThreadId,
      cwd: workspaceDir,
      agent: { command: process.execPath, args: [FAKE_AGENT_PATH] },
      permissionMode: "full",
      permissionEscalation: null,
      workspaceWriteRoots: [workspaceDir],
      envVars: {
        FAKE_ACP_LOAD_SESSION: "1",
        FAKE_ACP_USAGE_ON_LOAD: "1",
      },
    });
    const response = await waitForResponse(resumeId);
    expect(response.result).toEqual({
      providerThreadId: first.providerThreadId,
    });
    expect(notifications("acp/update").at(-1)?.params).toEqual({
      threadId: first.patcherThreadId,
      update: {
        sessionUpdate: "usage_update",
        used: 24_000,
        size: 128_000,
      },
    });
    startedProviderThreadIds.push(first.providerThreadId);
  });

  it("ignores load-time context usage for a different session", async () => {
    const first = await startThread({
      envVars: { FAKE_ACP_LOAD_SESSION: "1" },
    });
    await stopThread(first.providerThreadId);
    startedProviderThreadIds.pop();

    const resumeId = sendRequest("thread/resume", {
      threadId: first.patcherThreadId,
      providerThreadId: first.providerThreadId,
      cwd: workspaceDir,
      agent: { command: process.execPath, args: [FAKE_AGENT_PATH] },
      permissionMode: "full",
      permissionEscalation: null,
      workspaceWriteRoots: [workspaceDir],
      envVars: {
        FAKE_ACP_LOAD_SESSION: "1",
        FAKE_ACP_USAGE_ON_LOAD: "1",
        FAKE_ACP_USAGE_SESSION_ID: "different-session",
      },
    });
    const response = await waitForResponse(resumeId);
    expect(response.result).toEqual({
      providerThreadId: first.providerThreadId,
    });
    expect(notifications("acp/update")).toEqual([]);
    startedProviderThreadIds.push(first.providerThreadId);
  });

  it("discards load-time context usage when session/load fails", async () => {
    const first = await startThread({
      envVars: { FAKE_ACP_LOAD_SESSION: "1" },
    });
    await stopThread(first.providerThreadId);
    startedProviderThreadIds.pop();

    const resumeId = sendRequest("thread/resume", {
      threadId: first.patcherThreadId,
      providerThreadId: first.providerThreadId,
      cwd: workspaceDir,
      agent: { command: process.execPath, args: [FAKE_AGENT_PATH] },
      permissionMode: "full",
      permissionEscalation: null,
      workspaceWriteRoots: [workspaceDir],
      envVars: {
        FAKE_ACP_FAIL_LOAD: "1",
        FAKE_ACP_USAGE_ON_LOAD: "1",
      },
    });
    const response = await waitForResponse(resumeId);
    const result = response.result;
    if (
      typeof result !== "object" ||
      result === null ||
      Array.isArray(result) ||
      typeof result.providerThreadId !== "string"
    ) {
      throw new Error("thread/resume did not return a providerThreadId");
    }
    expect(result.providerThreadId).not.toBe(first.providerThreadId);
    expect(notifications("acp/update")).toEqual([]);
    expect(notifications("acp/warning").at(-1)?.params).toMatchObject({
      threadId: first.patcherThreadId,
    });
    startedProviderThreadIds.push(result.providerThreadId);
  });

  it("re-applies ACP-native reasoning after session/load resume", async () => {
    const first = await startThread({
      envVars: {
        FAKE_ACP_LOAD_SESSION: "1",
        FAKE_ACP_MODEL_CONFIG: "1",
        FAKE_ACP_THOUGHT_LEVEL_CONFIG: "1",
      },
    });
    await stopThread(first.providerThreadId);
    startedProviderThreadIds.pop();

    const resumeId = sendRequest("thread/resume", {
      threadId: first.patcherThreadId,
      providerThreadId: first.providerThreadId,
      cwd: workspaceDir,
      agent: { command: process.execPath, args: [FAKE_AGENT_PATH] },
      modelSelection: { modelId: "fake/strong", reasoningLevel: "high" },
      permissionMode: "full",
      permissionEscalation: null,
      workspaceWriteRoots: [workspaceDir],
      envVars: {
        FAKE_ACP_LOAD_SESSION: "1",
        FAKE_ACP_MODEL_CONFIG: "1",
        FAKE_ACP_THOUGHT_LEVEL_CONFIG: "1",
      },
    });
    const response = await waitForResponse(resumeId);
    expect(response.result).toEqual({
      providerThreadId: first.providerThreadId,
    });
    startedProviderThreadIds.push(first.providerThreadId);

    sendRequest("turn/start", {
      threadId: first.providerThreadId,
      input: [{ type: "text", text: "echo-selected-effort", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("selected-effort:high");
  });

  it("falls back to a fresh session with a warning when load is unsupported", async () => {
    const resumeId = sendRequest("thread/resume", {
      threadId: "thread-resume-fallback",
      providerThreadId: "fake-sess-stale",
      cwd: workspaceDir,
      agent: { command: process.execPath, args: [FAKE_AGENT_PATH] },
      permissionMode: "full",
      permissionEscalation: null,
      workspaceWriteRoots: [workspaceDir],
    });
    const response = await waitForResponse(resumeId);
    const result = response.result;
    if (
      typeof result !== "object" ||
      result === null ||
      Array.isArray(result) ||
      typeof result.providerThreadId !== "string"
    ) {
      throw new Error("thread/resume did not return a providerThreadId");
    }
    expect(result.providerThreadId).not.toBe("fake-sess-stale");
    startedProviderThreadIds.push(result.providerThreadId);

    const warning = notifications("acp/warning").at(-1);
    expect(warning?.params).toMatchObject({
      threadId: "thread-resume-fallback",
    });
  });

  it("reports unexpected agent exits as a single provider error", async () => {
    const { patcherThreadId, providerThreadId } = await startThread();
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "die", mentions: [] }],
    });
    await waitForResponse(turnId);

    const errors = await waitFor(() => {
      const errorNotifications = notifications("error");
      return errorNotifications.length > 0 ? errorNotifications : undefined;
    }, "agent exit error notification");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.params).toMatchObject({ threadId: patcherThreadId });
    // The session is gone; a stop for it settles without error.
    startedProviderThreadIds.pop();
  });

  it("fails thread/start with a clear error when the agent command is missing", async () => {
    const id = sendRequest("thread/start", {
      threadId: "thread-missing-agent",
      cwd: workspaceDir,
      agent: { command: "definitely-not-a-real-binary-patcher", args: [] },
      permissionMode: "full",
      permissionEscalation: null,
      workspaceWriteRoots: [workspaceDir],
    });
    const response = await waitForResponse(id);
    expect(response.error?.message).toMatch(
      /definitely-not-a-real-binary-patcher/,
    );
  });
});
