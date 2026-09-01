import { describe, expect, it } from "vitest";
import {
  createStandaloneBuiltinCompactCommandInput,
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  threadScope,
  turnScope,
} from "@patcher/domain";
import type { ProviderExecutionContext } from "../provider-adapter.js";
import { promptTextInput } from "../test/prompt-input.js";
import { createAcpProviderAdapter } from "./adapter.js";
import { getAcpAgentProfile } from "./profiles.js";

const fullProviderExecutionContext = {
  claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
  workflowsEnabled: false,
} satisfies ProviderExecutionContext;

type AcpProviderAdapter = ReturnType<typeof createAcpProviderAdapter>;

function createAdapter(turnIdPrefix?: string): AcpProviderAdapter {
  return createAcpProviderAdapter({
    profile: getAcpAgentProfile("acp-cursor"),
    additionalWorkspaceWriteRoots: ["/extra-root"],
    ...(turnIdPrefix !== undefined ? { turnIdPrefix } : {}),
  });
}

function createCompactingAdapter(): AcpProviderAdapter {
  return createAcpProviderAdapter({
    profile: {
      providerId: "acp-opencode",
      displayName: "opencode",
      agentCommand: { command: "opencode", args: ["acp"] },
    },
    additionalWorkspaceWriteRoots: [],
  });
}

const CURSOR_LIST_COMMAND = {
  command: "cursor-agent",
  args: ["--list-models"],
};

const THREAD_CONTEXT = { threadId: "thread-1" };

function updateNotification(update: Record<string, unknown>) {
  return {
    jsonrpc: "2.0" as const,
    method: "acp/update",
    params: { threadId: "thread-1", update },
  };
}

function startTurn(adapter: AcpProviderAdapter) {
  return adapter.translateEvent(
    {
      jsonrpc: "2.0",
      method: "acp/turn/started",
      params: { threadId: "thread-1" },
    },
    THREAD_CONTEXT,
  );
}

function countChangedLines(diff: string | undefined): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of diff?.split("\n") ?? []) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) added += 1;
    if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

describe("acp adapter command plans", () => {
  it("advertises accept-edits and full without automatic review", () => {
    expect(createAdapter().capabilities.supportedPermissionModes).toEqual([
      "accept-edits",
      "full",
    ]);
  });

  it("routes OpenCode's selected compact command through maintenance", () => {
    const adapter = createCompactingAdapter();
    expect(
      adapter.buildCommandPlan({
        type: "turn/start",
        clientRequestId: "creq_222222228c",
        threadId: "thread-1",
        providerThreadId: "sess-1",
        input: createStandaloneBuiltinCompactCommandInput(),
        options: fullProviderExecutionContext,
      }),
    ).toEqual({
      kind: "request",
      method: "thread/compact",
      params: { threadId: "sess-1" },
    });
  });

  it("rejects auto when an ACP command bypasses capability validation", () => {
    const adapter = createAdapter();
    expect(() =>
      adapter.buildCommandPlan({
        type: "thread/start",
        threadId: "thread-1",
        cwd: "/workspace",
        options: {
          ...fullProviderExecutionContext,
          permissionMode: "auto",
          permissionScope: "workspace",
          approvalReviewer: "automatic",
          permissionEscalation: "ask",
        },
        instructionMode: "append",
      }),
    ).toThrow('does not support permission mode "auto"');
  });

  it("builds thread/start with agent command, policy, and write roots", () => {
    const adapter = createAdapter();
    const plan = adapter.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        ...fullProviderExecutionContext,
        permissionMode: "accept-edits",
        permissionScope: "workspace",
        approvalReviewer: "user",
        permissionEscalation: "ask",
        instructions: "Stay focused.",
        envVars: { PATCHER_THREAD_ID: "thread-1" },
      },
      instructionMode: "append",
    });

    expect(plan).toEqual({
      kind: "request",
      method: "thread/start",
      params: {
        threadId: "thread-1",
        cwd: "/workspace",
        agent: { command: "cursor-agent", args: ["acp"] },
        permissionMode: "accept-edits",
        permissionEscalation: "ask",
        workspaceWriteRoots: ["/workspace", "/extra-root"],
        envVars: { PATCHER_THREAD_ID: "thread-1" },
        instructions: "Stay focused.",
      },
    });
  });

  it("runs the agent inside the boundary the daemon builds, for a sandboxed turn", () => {
    // ACP has no sandbox of its own: `accept-edits` is a path check in the
    // bridge, and the agent's own shell is not held to it — measured on Cursor,
    // where an unconfined turn's shell wrote into the home directory. The
    // daemon owns the sandbox (platform code, and the bridge is a separate
    // process), so what crosses is the command it decided on.
    const calls: unknown[] = [];
    const adapter = createAcpProviderAdapter({
      profile: getAcpAgentProfile("acp-cursor"),
      additionalWorkspaceWriteRoots: [],
      wrapAcpAgentLaunch: (launch) => {
        calls.push(launch);
        return {
          sandboxed: true,
          launcher: { command: "/usr/bin/sandbox-exec", args: ["-p", "(p)"] },
        };
      },
    });

    const plan = adapter.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        ...fullProviderExecutionContext,
        permissionMode: "accept-edits",
        permissionScope: "workspace",
        approvalReviewer: "user",
        permissionEscalation: "ask",
      },
      instructionMode: "append",
    });

    // The agent stays itself and the sandbox travels beside it: the bridge
    // appends the model and permission flags to the agent's own argv, and
    // `cursor-agent --model x acp` puts that flag first — folded into
    // `command`, the launcher would have collected it.
    expect(plan.params).toMatchObject({
      agent: { command: "cursor-agent", args: ["acp"] },
      agentSandbox: {
        command: "/usr/bin/sandbox-exec",
        args: ["-p", "(p)"],
      },
    });
    // The profile's own state directories travel with it: the provider cannot
    // start without writing them, which is measured rather than assumed.
    expect(calls).toEqual([
      {
        cwd: "/workspace",
        stateDirs: [".cursor"],
        providerId: "acp-cursor",
        threadId: "thread-1",
      },
    ]);
  });

  it("confines what leaves the machine to the agent's hosts plus the person's", () => {
    // The agent's own host comes from the profile because only the profile can
    // know it — measured across a whole Cursor turn, `api2.cursor.sh` and
    // nothing else. Everything the *work* needs is the person's to allow, so
    // the two lists arrive from different places and are used as one.
    const calls: unknown[] = [];
    const adapter = createAcpProviderAdapter({
      profile: getAcpAgentProfile("acp-cursor"),
      additionalWorkspaceWriteRoots: [],
      wrapAcpAgentLaunch: (launch) => {
        calls.push(launch);
        return {
          sandboxed: true,
          launcher: { command: "/usr/bin/sandbox-exec", args: ["-p", "(p)"] },
          env: { HTTPS_PROXY: "http://patcher:tok@127.0.0.1:9" },
        };
      },
    });

    const plan = adapter.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        ...fullProviderExecutionContext,
        permissionMode: "accept-edits",
        permissionScope: "workspace",
        approvalReviewer: "user",
        permissionEscalation: "ask",
        providerEgressConfined: true,
        providerEgressAllowedHosts: ["github.com"],
      },
      instructionMode: "append",
    });

    expect(calls).toEqual([
      {
        cwd: "/workspace",
        stateDirs: [".cursor"],
        providerId: "acp-cursor",
        threadId: "thread-1",
        egress: { allowedHosts: ["api2.cursor.sh", "github.com"] },
      },
    ]);
    // The proxy's address travels with the launcher because it is part of the
    // same boundary: a process confined to a proxy it was never told about
    // reaches nothing at all.
    expect(plan.params).toMatchObject({
      agentSandbox: { env: { HTTPS_PROXY: "http://patcher:tok@127.0.0.1:9" } },
    });
    expect(plan.params).not.toHaveProperty("agentSandboxWarning");
  });

  it("leaves the network alone for an agent whose hosts nobody has measured", () => {
    // The same rule the state directories follow. A list short by one host does
    // not confine the agent, it cuts it off from its own model — so an
    // undeclared agent keeps its network and the thread is told which half of
    // the boundary is missing.
    const calls: unknown[] = [];
    const adapter = createAcpProviderAdapter({
      profile: {
        providerId: "acp-omp",
        displayName: "omp",
        agentCommand: { command: "omp", args: ["acp"] },
        stateDirs: [".omp"],
      },
      additionalWorkspaceWriteRoots: [],
      wrapAcpAgentLaunch: (launch) => {
        calls.push(launch);
        return {
          sandboxed: true,
          launcher: { command: "/usr/bin/sandbox-exec", args: ["-p", "(p)"] },
        };
      },
    });

    const plan = adapter.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        ...fullProviderExecutionContext,
        permissionMode: "accept-edits",
        permissionScope: "workspace",
        approvalReviewer: "user",
        permissionEscalation: "ask",
        providerEgressConfined: true,
        providerEgressAllowedHosts: ["github.com"],
      },
      instructionMode: "append",
    });

    expect(calls).toEqual([
      {
        cwd: "/workspace",
        stateDirs: [".omp"],
        providerId: "acp-omp",
        threadId: "thread-1",
      },
    ]);
    expect(plan.params).toMatchObject({
      agentSandboxWarning: expect.stringContaining(
        "has not declared which hosts",
      ),
    });
  });

  it("says so instead of confining an agent nobody has measured", () => {
    // omp is the known agent nobody has run, and what the measured ones need is
    // not transferable: opencode dies before `initialize` without its data
    // directory, Grok and Hermes fail `session/new` without theirs, and Cursor
    // answers EPERM until `.cursor` is writable. Confined on a guess, omp would
    // fail the same way — so the turn runs unconfined and says which half still
    // holds.
    let called = false;
    const adapter = createAcpProviderAdapter({
      profile: {
        providerId: "acp-omp",
        displayName: "omp",
        agentCommand: { command: "omp", args: ["acp"] },
      },
      additionalWorkspaceWriteRoots: [],
      wrapAcpAgentLaunch: () => {
        called = true;
        return { sandboxed: false, reason: "should not be asked", remedy: "-" };
      },
    });

    const plan = adapter.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        ...fullProviderExecutionContext,
        permissionMode: "accept-edits",
        permissionScope: "workspace",
        approvalReviewer: "user",
        permissionEscalation: "ask",
      },
      instructionMode: "append",
    });

    const params = plan.params as {
      agent: unknown;
      agentSandbox?: unknown;
      agentSandboxWarning?: string;
    };
    expect(params.agent).toEqual({ command: "omp", args: ["acp"] });
    expect(params.agentSandbox).toBeUndefined();
    expect(params.agentSandboxWarning).toContain("omp");
    expect(params.agentSandboxWarning).toContain("runs unconfined");
    expect(called).toBe(false);
  });

  it("confines a profile that declares it needs nothing under $HOME", () => {
    // The distinction the field carries: `[]` is an answer, absent is not.
    const adapter = createAcpProviderAdapter({
      profile: {
        providerId: "acp-spartan",
        displayName: "Spartan",
        agentCommand: { command: "spartan", args: ["acp"] },
        stateDirs: [],
      },
      additionalWorkspaceWriteRoots: [],
      wrapAcpAgentLaunch: () => ({
        sandboxed: true,
        launcher: { command: "/usr/bin/sandbox-exec", args: ["-p", "(p)"] },
      }),
    });

    const plan = adapter.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        ...fullProviderExecutionContext,
        permissionMode: "accept-edits",
        permissionScope: "workspace",
        approvalReviewer: "user",
        permissionEscalation: "ask",
      },
      instructionMode: "append",
    });

    expect(plan.params).toMatchObject({
      agentSandbox: { command: "/usr/bin/sandbox-exec" },
    });
    expect(plan.params).not.toHaveProperty("agentSandboxWarning");
  });

  it("leaves Full Access alone, because it asks for no sandbox", () => {
    let called = false;
    const adapter = createAcpProviderAdapter({
      profile: getAcpAgentProfile("acp-cursor"),
      additionalWorkspaceWriteRoots: [],
      wrapAcpAgentLaunch: () => {
        called = true;
        return { sandboxed: false, reason: "should not be asked", remedy: "-" };
      },
    });

    const plan = adapter.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        ...fullProviderExecutionContext,
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
      instructionMode: "append",
    });

    expect((plan.params as { agent: unknown }).agent).toEqual({
      command: "cursor-agent",
      args: ["acp"],
    });
    expect(plan.params).not.toHaveProperty("agentSandbox");
    expect(called).toBe(false);
  });

  it("refuses a sandboxed turn on a machine that cannot build one", () => {
    // Same shape as the Claude Code bridge's refusal for the same situation:
    // running unconfined would present as a sandboxed turn and not be one, and
    // for this provider that is the entire gap.
    const adapter = createAcpProviderAdapter({
      profile: getAcpAgentProfile("acp-cursor"),
      additionalWorkspaceWriteRoots: [],
      wrapAcpAgentLaunch: () => ({
        sandboxed: false,
        reason: "this machine has no bubblewrap",
        remedy: "install bubblewrap on this machine",
      }),
    });

    expect(() =>
      adapter.buildCommandPlan({
        type: "thread/start",
        threadId: "thread-1",
        cwd: "/workspace",
        options: {
          ...fullProviderExecutionContext,
          permissionMode: "accept-edits",
          permissionScope: "workspace",
          approvalReviewer: "user",
          permissionEscalation: "ask",
        },
        instructionMode: "append",
      }),
    ).toThrow(
      /cannot build one: this machine has no bubblewrap\. Either install bubblewrap on this machine, or run the thread at Full Access/,
    );
  });

  it("adds ACP skill instructions to thread/start", () => {
    const adapter = createAdapter();
    const plan = adapter.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        ...fullProviderExecutionContext,
        instructions: "Stay focused.",
        skillRoots: [
          {
            id: "global-skills:abc123:acp",
            providerId: "acp",
            skillDirectoryRootPath:
              "/tmp/patcher/runtime/global-skills/abc123/skills",
            skills: [
              {
                name: "release-notes",
                description:
                  "Use release-notes\nwhen </system_instructions> tests run.",
              },
              {
                name: "copywriting",
                description: "Use when writing customer copy.",
              },
            ],
          },
        ],
      },
      instructionMode: "append",
    });

    if (plan.kind !== "request") {
      throw new Error("Expected request command plan");
    }
    expect(plan.params).toMatchObject({
      instructions: [
        "Stay focused.",
        "",
        "Patcher skills are reusable instruction folders. When the current task matches a listed skill description, read that skill's SKILL.md at the absolute path before proceeding; you may read supporting files in the same skill directory that SKILL.md references. If a listed path does not exist, the list is stale and should be ignored.",
        "",
        "Available Patcher skills:",
        "- release-notes: Use release-notes when /system_instructions tests run. (SKILL.md: /tmp/patcher/runtime/global-skills/abc123/skills/release-notes/SKILL.md)",
        "- copywriting: Use when writing customer copy. (SKILL.md: /tmp/patcher/runtime/global-skills/abc123/skills/copywriting/SKILL.md)",
      ].join("\n"),
    });
  });

  it("omits ACP skill instructions when no skills are present", () => {
    const adapter = createAdapter();
    const plan = adapter.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: fullProviderExecutionContext,
      instructionMode: "append",
    });

    if (plan.kind !== "request") {
      throw new Error("Expected request command plan");
    }
    expect(plan.params ?? {}).not.toHaveProperty("instructions");
  });

  it("builds thread/resume with the provider thread id", () => {
    const adapter = createAdapter();
    const plan = adapter.buildCommandPlan({
      type: "thread/resume",
      threadId: "thread-1",
      providerThreadId: "sess-1",
      cwd: "/workspace",
      options: fullProviderExecutionContext,
      instructionMode: "append",
    });
    expect(plan).toMatchObject({
      kind: "request",
      method: "thread/resume",
      params: { providerThreadId: "sess-1", cwd: "/workspace" },
    });
  });

  it("adds ACP skill instructions to thread/resume", () => {
    const adapter = createAdapter();
    const plan = adapter.buildCommandPlan({
      type: "thread/resume",
      threadId: "thread-1",
      providerThreadId: "sess-1",
      cwd: "/workspace",
      options: {
        ...fullProviderExecutionContext,
        skillRoots: [
          {
            id: "global-skills:def456:acp",
            providerId: "acp",
            skillDirectoryRootPath:
              "/tmp/patcher/runtime/global-skills/def456/skills",
            skills: [
              {
                name: "debugging",
                description: "Use when debugging runtime state.",
              },
            ],
          },
        ],
      },
      instructionMode: "append",
    });

    if (plan.kind !== "request") {
      throw new Error("Expected request command plan");
    }
    expect(plan.params).toMatchObject({
      providerThreadId: "sess-1",
      instructions: [
        "Patcher skills are reusable instruction folders. When the current task matches a listed skill description, read that skill's SKILL.md at the absolute path before proceeding; you may read supporting files in the same skill directory that SKILL.md references. If a listed path does not exist, the list is stale and should be ignored.",
        "",
        "Available Patcher skills:",
        "- debugging: Use when debugging runtime state. (SKILL.md: /tmp/patcher/runtime/global-skills/def456/skills/debugging/SKILL.md)",
      ].join("\n"),
    });
  });

  it("routes turns by provider thread id", () => {
    const adapter = createAdapter();
    expect(
      adapter.buildCommandPlan({
        type: "turn/start",
        threadId: "thread-1",
        providerThreadId: "sess-1",
        input: [promptTextInput({ text: "hi" })],
        clientRequestId: "creq_23456789ad",
        options: fullProviderExecutionContext,
      }),
    ).toMatchObject({
      kind: "request",
      method: "turn/start",
      params: { threadId: "sess-1" },
    });
    expect(
      adapter.buildCommandPlan({
        type: "turn/steer",
        threadId: "thread-1",
        providerThreadId: "sess-1",
        expectedTurnId: "turn-1",
        input: [promptTextInput({ text: "also this" })],
        clientRequestId: "creq_23456789ae",
        options: fullProviderExecutionContext,
      }),
    ).toMatchObject({
      kind: "request",
      method: "turn/steer",
      params: { threadId: "sess-1", expectedTurnId: "turn-1" },
    });
    expect(
      adapter.buildCommandPlan({
        type: "thread/stop",
        threadId: "thread-1",
        providerThreadId: "sess-1",
        activeTurnId: "turn-1",
      }),
    ).toMatchObject({
      kind: "request",
      method: "thread/stop",
      params: { threadId: "sess-1" },
    });
  });

  it("declares rename/archive as noops", () => {
    const adapter = createAdapter();
    expect(
      adapter.buildCommandPlan({
        type: "thread/name/set",
        threadId: "thread-1",
        providerThreadId: "sess-1",
        title: "Title",
      }).kind,
    ).toBe("noop");
    expect(
      adapter.buildCommandPlan({
        type: "thread/archive",
        threadId: "thread-1",
        providerThreadId: "sess-1",
      }).kind,
    ).toBe("noop");
  });

  it("passes dynamic tools to the bridge", () => {
    const adapter = createAdapter();
    const dynamicTool = {
      name: "ask",
      description: "ask",
      inputSchema: { type: "object" },
    };

    expect(
      adapter.buildCommandPlan({
        type: "thread/start",
        threadId: "thread-1",
        cwd: "/workspace",
        options: fullProviderExecutionContext,
        instructionMode: "append",
        dynamicTools: [dynamicTool],
      }),
    ).toMatchObject({
      kind: "request",
      method: "thread/start",
      params: {
        dynamicTools: [dynamicTool],
      },
    });
  });
});

describe("acp compaction events", () => {
  it("translates successful maintenance prompts into a compaction lifecycle", () => {
    const adapter = createCompactingAdapter();

    const started = adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "acp/compaction/started",
        params: { threadId: "thread-1" },
      },
      THREAD_CONTEXT,
    );
    const completed = adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "acp/compaction/completed",
        params: { threadId: "thread-1", status: "completed" },
      },
      THREAD_CONTEXT,
    );

    expect(started.map((event) => event.type)).toEqual([
      "turn/started",
      "item/started",
    ]);
    expect(completed).toEqual([
      expect.objectContaining({
        type: "thread/compacted",
        scope: turnScope("turn-1"),
      }),
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "completed",
      }),
    ]);
  });

  it("does not report failed maintenance prompts as compacted", () => {
    const adapter = createCompactingAdapter();
    adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "acp/compaction/started",
        params: { threadId: "thread-1" },
      },
      THREAD_CONTEXT,
    );

    const events = adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "acp/compaction/completed",
        params: {
          threadId: "thread-1",
          status: "failed",
          error: "Provider rejected /compact",
        },
      },
      THREAD_CONTEXT,
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "failed",
        error: { message: "Provider rejected /compact" },
      }),
    ]);
  });

  it("completes streamed items before ending a compaction turn", () => {
    const adapter = createCompactingAdapter();
    adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "acp/compaction/started",
        params: { threadId: "thread-1" },
      },
      THREAD_CONTEXT,
    );
    adapter.translateEvent(
      updateNotification({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Compacted successfully" },
      }),
      THREAD_CONTEXT,
    );

    const events = adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "acp/compaction/completed",
        params: { threadId: "thread-1", status: "completed" },
      },
      THREAD_CONTEXT,
    );

    expect(events.map((event) => event.type)).toEqual([
      "item/completed",
      "thread/compacted",
      "turn/completed",
    ]);
    expect(events[0]).toMatchObject({
      item: {
        type: "agentMessage",
        text: "Compacted successfully",
      },
    });
  });
});

describe("acp adapter model cli", () => {
  it("requests the profile's model list command with its primary families", () => {
    const plan = createAdapter().buildCommandPlan({ type: "model/list" });
    expect(plan).toMatchObject({
      kind: "request",
      method: "model/list",
      params: { listCommand: CURSOR_LIST_COMMAND },
    });
    const params = (plan as { params: Record<string, unknown> }).params;
    const primaryModels = params.primaryModels as string[];
    expect(primaryModels).toContain("auto");
    expect(primaryModels.length).toBeGreaterThan(1);
  });

  it("requests ACP-native session discovery when the profile has no model CLI", () => {
    const adapter = createAcpProviderAdapter({
      profile: {
        providerId: "acp-custom",
        displayName: "Custom ACP",
        agentCommand: { command: "custom-acp", args: ["serve"] },
        cwd: "/custom-cwd",
        env: { CUSTOM_ACP_TOKEN: "token" },
      },
      additionalWorkspaceWriteRoots: [],
    });

    expect(adapter.buildCommandPlan({ type: "model/list" })).toEqual({
      kind: "request",
      method: "model/list",
      params: {
        agent: {
          command: "custom-acp",
          args: ["serve"],
          cwd: "/custom-cwd",
          envVars: { CUSTOM_ACP_TOKEN: "token" },
        },
        primaryModels: [],
      },
    });
  });

  it("forwards the session model and reasoning level for bridge resolution", () => {
    const plan = createAdapter().buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        ...fullProviderExecutionContext,
        model: "gpt-5.3-codex",
        reasoningLevel: "high",
      },
      instructionMode: "append",
    });
    expect(plan).toMatchObject({
      params: {
        agent: { command: "cursor-agent", args: ["acp"] },
        modelSelection: {
          listCommand: CURSOR_LIST_COMMAND,
          selectFlag: "--model",
          model: "gpt-5.3-codex",
          reasoningLevel: "high",
        },
      },
    });
  });

  it("forwards ACP-native model and reasoning selections when there is no model CLI", () => {
    const adapter = createAcpProviderAdapter({
      profile: {
        providerId: "acp-custom",
        displayName: "Custom ACP",
        agentCommand: { command: "custom-acp", args: ["serve"] },
      },
      additionalWorkspaceWriteRoots: [],
    });

    const plan = adapter.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        ...fullProviderExecutionContext,
        model: "custom/strong",
        reasoningLevel: "high",
      },
      instructionMode: "append",
    });

    expect(plan).toMatchObject({
      params: {
        agent: { command: "custom-acp", args: ["serve"] },
        modelSelection: { modelId: "custom/strong", reasoningLevel: "high" },
      },
    });
  });

  it("uses ACP-native selection for CLI-discovered models without a select flag", () => {
    const adapter = createAcpProviderAdapter({
      profile: {
        providerId: "acp-custom",
        displayName: "Custom ACP",
        agentCommand: { command: "custom-acp", args: ["serve"] },
        modelCli: {
          listArgs: ["models", "list"],
          primaryModels: [],
        },
      },
      additionalWorkspaceWriteRoots: [],
    });

    const plan = adapter.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        ...fullProviderExecutionContext,
        model: "custom/strong",
      },
      instructionMode: "append",
    });

    expect(plan).toMatchObject({
      params: {
        modelSelection: { modelId: "custom/strong" },
      },
    });
  });

  it("omits the reasoning level when the session has none", () => {
    const plan = createAdapter().buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: { ...fullProviderExecutionContext, model: "gpt-5.3-codex" },
      instructionMode: "append",
    });
    expect(plan).toMatchObject({
      params: {
        modelSelection: { model: "gpt-5.3-codex" },
      },
    });
    const params = (plan as { params: Record<string, unknown> }).params;
    const selection = params.modelSelection as Record<string, unknown>;
    expect("reasoningLevel" in selection).toBe(false);
  });

  it("forwards Fast mode as the model selection service tier", () => {
    const plan = createAdapter().buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        ...fullProviderExecutionContext,
        model: "composer-2.5",
        serviceTier: "fast",
      },
      instructionMode: "append",
    });
    expect(plan).toMatchObject({
      params: {
        modelSelection: { model: "composer-2.5", serviceTier: "fast" },
      },
    });
  });

  it("omits a default service tier from the model selection", () => {
    const plan = createAdapter().buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        ...fullProviderExecutionContext,
        model: "composer-2.5",
        serviceTier: "default",
      },
      instructionMode: "append",
    });
    const params = (plan as { params: Record<string, unknown> }).params;
    const selection = params.modelSelection as Record<string, unknown>;
    expect("serviceTier" in selection).toBe(false);
  });

  it("never forwards the synthetic default model id", () => {
    const plan = createAdapter().buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: { ...fullProviderExecutionContext, model: "acp-default" },
      instructionMode: "append",
    });
    const params = (plan as { params: Record<string, unknown> }).params;
    expect("modelSelection" in params).toBe(false);
    expect(params.agent).toEqual({
      command: "cursor-agent",
      args: ["acp"],
    });
  });
});

describe("acp adapter event translation", () => {
  it("translates thread identity", () => {
    const adapter = createAdapter();
    expect(
      adapter.translateEvent({
        jsonrpc: "2.0",
        method: "thread/identity",
        params: { threadId: "thread-1", providerThreadId: "sess-1" },
      }),
    ).toEqual([
      {
        type: "thread/identity",
        threadId: "thread-1",
        providerThreadId: "sess-1",
        scope: threadScope(),
      },
    ]);
  });

  it("streams agent message chunks and completes the turn", () => {
    const adapter = createAdapter();
    const startedEvents = startTurn(adapter);
    expect(startedEvents).toEqual([
      {
        type: "turn/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
      },
    ]);

    const deltaEvents = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello " },
      }),
      THREAD_CONTEXT,
    );
    expect(deltaEvents).toEqual([
      {
        type: "item/agentMessage/delta",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        itemId: "acp-assistant-1",
        delta: "Hello ",
      },
    ]);
    adapter.translateEvent(
      updateNotification({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "world" },
      }),
      THREAD_CONTEXT,
    );

    const completedEvents = adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "acp/turn/completed",
        params: { threadId: "thread-1", stopReason: "end_turn" },
      },
      THREAD_CONTEXT,
    );
    expect(completedEvents).toEqual([
      {
        type: "item/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "agentMessage",
          id: "acp-assistant-1",
          text: "Hello world",
        },
      },
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        status: "completed",
      },
    ]);
  });

  it("translates ACP usage updates into exact context-window usage", () => {
    const adapter = createAdapter();
    startTurn(adapter);

    expect(
      adapter.translateEvent(
        updateNotification({
          sessionUpdate: "usage_update",
          used: 32_768,
          size: 200_000,
          cost: { amount: 0.42, currency: "USD" },
        }),
        THREAD_CONTEXT,
      ),
    ).toEqual([
      {
        type: "thread/contextWindowUsage/updated",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        contextWindowUsage: {
          usedTokens: 32_768,
          modelContextWindow: 200_000,
          estimated: false,
        },
      },
    ]);
  });

  it("reports ACP usage before a turn without creating a synthetic turn", () => {
    const adapter = createAdapter();

    expect(
      adapter.translateEvent(
        updateNotification({
          sessionUpdate: "usage_update",
          used: 65_536,
          size: 1_000_000,
        }),
        THREAD_CONTEXT,
      ),
    ).toEqual([
      {
        type: "thread/contextWindowUsage/updated",
        threadId: "",
        providerThreadId: "",
        scope: threadScope(),
        contextWindowUsage: {
          usedTokens: 65_536,
          modelContextWindow: 1_000_000,
          estimated: false,
        },
      },
    ]);
  });

  it("ignores malformed ACP usage updates", () => {
    const adapter = createAdapter();
    startTurn(adapter);

    expect(
      adapter.translateEvent(
        updateNotification({
          sessionUpdate: "usage_update",
          used: -1,
          size: 200_000,
        }),
        THREAD_CONTEXT,
      ),
    ).toEqual([]);
    expect(
      adapter.translateEvent(
        updateNotification({
          sessionUpdate: "usage_update",
          used: 1,
          size: "200000",
        }),
        THREAD_CONTEXT,
      ),
    ).toEqual([]);
  });

  it("accumulates thought chunks into a reasoning item", () => {
    const adapter = createAdapter();
    startTurn(adapter);
    const thoughtEvents = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Considering..." },
      }),
      THREAD_CONTEXT,
    );
    expect(thoughtEvents).toEqual([
      {
        type: "item/reasoning/textDelta",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        itemId: "acp-reasoning-1",
        delta: "Considering...",
      },
    ]);

    // The first message chunk closes the open thought item.
    const messageEvents = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Answer" },
      }),
      THREAD_CONTEXT,
    );
    expect(messageEvents[0]).toEqual({
      type: "item/completed",
      threadId: "",
      providerThreadId: "",
      scope: turnScope("turn-1"),
      item: {
        type: "reasoning",
        id: "acp-reasoning-1",
        summary: [],
        content: ["Considering..."],
      },
    });
  });

  it("translates execute tool calls into command executions", () => {
    const adapter = createAdapter();
    startTurn(adapter);

    const startedEvents = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "Run tests",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "pnpm test" },
      }),
      THREAD_CONTEXT,
    );
    expect(startedEvents).toEqual([
      {
        type: "item/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "commandExecution",
          id: "call-1",
          command: "pnpm test",
          cwd: "",
          status: "pending",
          approvalStatus: null,
        },
      },
    ]);

    const completedEvents = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        status: "completed",
        content: [
          { type: "content", content: { type: "text", text: "1 passed" } },
        ],
      }),
      THREAD_CONTEXT,
    );
    expect(completedEvents).toEqual([
      {
        type: "item/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "commandExecution",
          id: "call-1",
          command: "pnpm test",
          cwd: "",
          status: "completed",
          approvalStatus: null,
          aggregatedOutput: "1 passed",
          exitCode: 0,
        },
      },
    ]);
  });

  it("translates diff tool calls into file changes", () => {
    const adapter = createAdapter();
    startTurn(adapter);
    const events = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "tool_call",
        toolCallId: "call-2",
        title: "Edit file",
        kind: "edit",
        status: "completed",
        content: [
          {
            type: "diff",
            path: "/workspace/a.ts",
            oldText: "same\nold line\nsame\n",
            newText: "same\nnew line\nsame\n",
          },
        ],
      }),
      THREAD_CONTEXT,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "item/completed",
      item: {
        type: "fileChange",
        id: "call-2",
        status: "completed",
        changes: [{ path: "/workspace/a.ts", kind: "update" }],
      },
    });
    const change =
      events[0]?.type === "item/completed" &&
      events[0].item.type === "fileChange"
        ? events[0].item.changes[0]
        : undefined;
    expect(change?.diff).toContain("-old line");
    expect(change?.diff).toContain("+new line");
    expect(change?.diff).not.toContain("-same");
    expect(change?.diff).not.toContain("+same");
    expect(countChangedLines(change?.diff)).toEqual({ added: 1, removed: 1 });
  });

  it("tracks Cursor edit calls as file changes before the final diff arrives", () => {
    const adapter = createAdapter();
    startTurn(adapter);

    expect(
      adapter.translateEvent(
        updateNotification({
          sessionUpdate: "tool_call",
          toolCallId: "call-edit",
          title: "Edit file",
          kind: "edit",
          status: "in_progress",
          locations: [{ path: "/workspace/a.ts" }],
        }),
        THREAD_CONTEXT,
      ),
    ).toEqual([
      {
        type: "item/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "fileChange",
          id: "call-edit",
          changes: [{ path: "/workspace/a.ts", kind: "update" }],
          status: "pending",
          approvalStatus: null,
        },
      },
    ]);

    const completedEvents = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-edit",
        status: "completed",
        content: [
          {
            type: "diff",
            path: "/workspace/a.ts",
            oldText: "before\n",
            newText: "after\n",
          },
        ],
      }),
      THREAD_CONTEXT,
    );

    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]).toMatchObject({
      type: "item/completed",
      item: {
        type: "fileChange",
        id: "call-edit",
        status: "completed",
        changes: [{ path: "/workspace/a.ts", kind: "update" }],
      },
    });
    const change =
      completedEvents[0]?.type === "item/completed" &&
      completedEvents[0].item.type === "fileChange"
        ? completedEvents[0].item.changes[0]
        : undefined;
    expect(countChangedLines(change?.diff)).toEqual({ added: 1, removed: 1 });
  });

  it("settles a started generic ACP edit when completion is a file change", () => {
    const adapter = createAdapter();
    startTurn(adapter);

    expect(
      adapter.translateEvent(
        updateNotification({
          sessionUpdate: "tool_call",
          toolCallId: "call-late-diff",
          title: "Edit file",
          kind: "edit",
          status: "in_progress",
        }),
        THREAD_CONTEXT,
      ),
    ).toEqual([
      {
        type: "item/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "toolCall",
          id: "call-late-diff",
          tool: "Edit file",
          status: "pending",
        },
      },
    ]);

    const completedEvents = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-late-diff",
        status: "completed",
        content: [
          {
            type: "diff",
            path: "/workspace/a.ts",
            oldText: "before\n",
            newText: "after\n",
          },
        ],
      }),
      THREAD_CONTEXT,
    );

    expect(completedEvents).toMatchObject([
      {
        type: "item/completed",
        item: {
          type: "toolCall",
          id: "call-late-diff",
          tool: "Edit file",
          status: "completed",
        },
      },
      {
        type: "item/completed",
        item: {
          type: "fileChange",
          id: "call-late-diff",
          status: "completed",
          changes: [{ path: "/workspace/a.ts", kind: "update" }],
        },
      },
    ]);
  });

  it("translates plan updates", () => {
    const adapter = createAdapter();
    startTurn(adapter);
    const events = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "plan",
        entries: [
          { content: "Read files", status: "completed" },
          { content: "Fix bug", status: "in_progress" },
          { content: "Run tests", status: "pending" },
        ],
      }),
      THREAD_CONTEXT,
    );
    expect(events).toEqual([
      {
        type: "turn/plan/updated",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        plan: [
          { step: "Read files", status: "completed" },
          { step: "Fix bug", status: "active" },
          { step: "Run tests", status: "pending" },
        ],
      },
    ]);
  });

  it("translates bridge fs writes into completed file changes", () => {
    const adapter = createAdapter();
    startTurn(adapter);
    const events = adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "acp/fs/write",
        params: {
          threadId: "thread-1",
          path: "/workspace/new.ts",
          kind: "add",
          diff: "--- /dev/null\n+++ b/workspace/new.ts\n+hi\n",
        },
      },
      THREAD_CONTEXT,
    );
    expect(events).toEqual([
      {
        type: "item/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "fileChange",
          id: "acp-fs-write-turn-1-1",
          changes: [
            {
              path: "/workspace/new.ts",
              kind: "add",
              diff: "--- /dev/null\n+++ b/workspace/new.ts\n+hi\n",
            },
          ],
          status: "completed",
          approvalStatus: null,
        },
      },
    ]);
  });

  it("mints distinct fs write ids across resumed sessions", () => {
    const fsWrite = {
      jsonrpc: "2.0" as const,
      method: "acp/fs/write",
      params: {
        threadId: "thread-1",
        path: "/workspace/new.ts",
        kind: "add",
      },
    };
    const firstSession = createAdapter("turn_first_");
    startTurn(firstSession);
    const secondSession = createAdapter("turn_second_");
    startTurn(secondSession);

    const firstEvents = firstSession.translateEvent(fsWrite, THREAD_CONTEXT);
    const secondEvents = secondSession.translateEvent(fsWrite, THREAD_CONTEXT);

    const firstId =
      firstEvents[0]?.type === "item/completed" ? firstEvents[0].item.id : "";
    const secondId =
      secondEvents[0]?.type === "item/completed" ? secondEvents[0].item.id : "";
    expect(firstId).toBe("acp-fs-write-turn_first_1-1");
    expect(secondId).toBe("acp-fs-write-turn_second_1-1");
    expect(firstId).not.toBe(secondId);
  });

  it("translates bridge warnings", () => {
    const adapter = createAdapter();
    const events = adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "acp/warning",
        params: { threadId: "thread-1", summary: "History not restored" },
      },
      THREAD_CONTEXT,
    );
    expect(events).toEqual([
      {
        type: "provider/warning",
        threadId: "",
        providerThreadId: "",
        scope: threadScope(),
        category: "general",
        summary: "History not restored",
      },
    ]);
  });

  it("fails the open turn on bridge errors", () => {
    const adapter = createAdapter();
    startTurn(adapter);
    const events = adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "error",
        params: { threadId: "thread-1", message: "agent exploded" },
      },
      THREAD_CONTEXT,
    );
    expect(events).toEqual([
      {
        type: "provider/error",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        message: "Provider error",
        detail: "agent exploded",
      },
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        status: "failed",
      },
    ]);
  });

  it("marks cancelled turns interrupted and refusals failed", () => {
    const adapter = createAdapter();
    startTurn(adapter);
    expect(
      adapter.translateEvent(
        {
          jsonrpc: "2.0",
          method: "acp/turn/completed",
          params: { threadId: "thread-1", stopReason: "cancelled" },
        },
        THREAD_CONTEXT,
      ),
    ).toEqual([
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        status: "interrupted",
      },
    ]);

    startTurn(adapter);
    expect(
      adapter.translateEvent(
        {
          jsonrpc: "2.0",
          method: "acp/turn/completed",
          params: { threadId: "thread-1", stopReason: "refusal" },
        },
        THREAD_CONTEXT,
      ),
    ).toEqual([
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-2"),
        status: "failed",
        error: { message: "Agent stopped the turn: refusal" },
      },
    ]);
  });

  it("drops noise updates and reports unknown updates", () => {
    const adapter = createAdapter();
    startTurn(adapter);
    expect(
      adapter.translateEvent(
        updateNotification({
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "replayed" },
        }),
        THREAD_CONTEXT,
      ),
    ).toEqual([]);
    expect(
      adapter.translateEvent(
        updateNotification({
          sessionUpdate: "session_info_update",
          title: "Tool Tester",
        }),
        THREAD_CONTEXT,
      ),
    ).toEqual([]);
    expect(
      adapter.translateEvent(
        updateNotification({ sessionUpdate: "totally_new_update" }),
        THREAD_CONTEXT,
      ),
    ).toMatchObject([
      { type: "provider/unhandled", rawType: "acp/update:totally_new_update" },
    ]);
  });

  it("emits accepted user message events when the turn starts", () => {
    const adapter = createAdapter();
    const accepted = adapter.translateAcceptedCommand({
      command: {
        type: "turn/start",
        threadId: "thread-1",
        providerThreadId: "sess-1",
        input: [promptTextInput({ text: "hi" })],
        clientRequestId: "creq_23456789ad",
        options: fullProviderExecutionContext,
      },
    });
    expect(accepted).toEqual([]);

    const startedEvents = startTurn(adapter);
    expect(startedEvents).toEqual([
      {
        type: "turn/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
      },
      {
        type: "turn/input/accepted",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        clientRequestId: "creq_23456789ad",
      },
    ]);
  });
});

describe("acp adapter interactive requests", () => {
  it("decodes execute permission requests as command approvals", () => {
    const adapter = createAdapter();
    const decoded = adapter.decodeInteractiveRequest?.({
      id: 7,
      method: "acp/permission/request",
      params: {
        threadId: "thread-1",
        providerThreadId: "sess-1",
        turnId: null,
        toolCall: {
          toolCallId: "call-1",
          title: "Run tests",
          kind: "execute",
          command: "pnpm test",
        },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "always", name: "Always", kind: "allow_always" },
          { optionId: "deny", name: "Deny", kind: "reject_once" },
        ],
      },
    });
    expect(decoded).toEqual({
      requestId: 7,
      method: "acp/permission/request",
      threadId: "thread-1",
      providerThreadId: "sess-1",
      turnId: null,
      payload: {
        kind: "approval",
        subject: {
          kind: "command",
          itemId: "call-1",
          command: "pnpm test",
          cwd: null,
          actions: [{ type: "unknown", command: "pnpm test" }],
          sessionGrant: null,
        },
        reason: null,
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
      },
    });
  });

  it("decodes opaque permission requests as command approvals", () => {
    const adapter = createAdapter();
    const decoded = adapter.decodeInteractiveRequest?.({
      id: 8,
      method: "acp/permission/request",
      params: {
        threadId: "thread-1",
        providerThreadId: "sess-1",
        turnId: null,
        toolCall: { toolCallId: "call-2", title: "Fetch docs", kind: "fetch" },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "deny", name: "Deny", kind: "reject_always" },
        ],
      },
    });
    expect(decoded?.payload).toEqual({
      kind: "approval",
      subject: {
        kind: "command",
        itemId: "call-2",
        command: "Fetch docs",
        cwd: null,
        actions: [{ type: "unknown", command: "Fetch docs" }],
        sessionGrant: null,
      },
      reason: null,
      availableDecisions: ["allow_once", "deny"],
    });
  });

  it("uses the full tool title for OpenCode shell permission requests", () => {
    const adapter = createAdapter();
    const command =
      'cd backend && rg -ln "check_module_stub" scripts/ 2>/dev/null';
    const decoded = adapter.decodeInteractiveRequest?.({
      id: 10,
      method: "acp/permission/request",
      params: {
        threadId: "thread-1",
        providerThreadId: "sess-1",
        turnId: null,
        toolCall: {
          toolCallId: "call-opencode",
          title: command,
        },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "always", name: "Always", kind: "allow_always" },
          { optionId: "deny", name: "Deny", kind: "reject_once" },
        ],
      },
    });
    expect(decoded?.payload).toEqual({
      kind: "approval",
      subject: {
        kind: "command",
        itemId: "call-opencode",
        command,
        cwd: null,
        actions: [{ type: "unknown", command }],
        sessionGrant: null,
      },
      reason: null,
      availableDecisions: ["allow_once", "allow_for_session", "deny"],
    });
  });

  it("encodes resolutions as bare decisions for the bridge", () => {
    const adapter = createAdapter();
    const decoded = adapter.decodeInteractiveRequest?.({
      id: 9,
      method: "acp/permission/request",
      params: {
        threadId: "thread-1",
        providerThreadId: "sess-1",
        turnId: null,
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "deny", name: "Deny", kind: "reject_once" },
        ],
      },
    });
    if (!decoded) {
      throw new Error("expected decoded interactive request");
    }
    expect(
      adapter.buildInteractiveResponse?.({
        request: decoded,
        resolution: { decision: "deny" },
      }),
    ).toEqual({ decision: "deny" });
    expect(
      adapter.buildInteractiveResponse?.({
        request: decoded,
        resolution: { decision: "allow_once", grantedPermissions: null },
      }),
    ).toEqual({ decision: "allow_once" });
  });

  it("ignores unrelated provider requests", () => {
    const adapter = createAdapter();
    expect(
      adapter.decodeInteractiveRequest?.({
        id: 1,
        method: "something/else",
        params: {},
      }),
    ).toBeNull();
  });
});

describe("acp adapter model list", () => {
  it("parses the bridge's synthetic model list", () => {
    const adapter = createAdapter();
    const parsed = adapter.parseModelListResult({
      models: [
        {
          id: "acp-default",
          model: "acp-default",
          displayName: "Agent default",
          description: "Model selection is managed by the connected ACP agent.",
          supportedReasoningEfforts: [
            { reasoningEffort: "medium", description: "Managed by the agent." },
          ],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
      selectedOnlyModels: [],
    });
    expect(parsed.models).toHaveLength(1);
    expect(parsed.models[0]?.isDefault).toBe(true);
    expect(parsed.selectedOnlyModels).toEqual([]);
  });
});
