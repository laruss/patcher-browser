import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@patcher/domain";
import { PI_BRIDGE_STATE_DIRS } from "./pi/bridge-sandbox.js";
import type {
  AdapterCommand,
  WrapAcpAgentLaunchArgs,
  WrapAcpAgentLaunchResult,
} from "./provider-adapter.js";
import { createAgentRuntimeWithAdapters } from "./runtime.js";
import { createFakeAdapter } from "./test/fake-adapter.js";
import { promptTextInput } from "./test/prompt-input.js";
import {
  findLastRecordedCommand,
  fullRuntimeOptions,
  waitForThreadAgentMessageText,
  waitForThreadTurnStarted,
} from "./test/runtime-test-harness.js";
import type { AgentRuntimeExecutionOptions } from "./types.js";

/**
 * The boundary of a turn whose provider runs its tools inside Patcher's own
 * bridge process — Pi, and nothing else today.
 *
 * Every other provider's boundary lives somewhere the bridge can hand it to:
 * Codex and Claude Code carry their own sandboxes, and an ACP bridge launches
 * its agent through the one Patcher builds. Pi's tools are `fs` calls on the
 * bridge's own thread, so the only place the sandbox can go is in front of the
 * bridge — which means the decision belongs to the process rather than to the
 * session, and a confined bridge and an unconfined one cannot be the same
 * process. These tests are about that: which process a turn lands on, and what
 * happens when it cannot land on the right one.
 */

const workspaceScopedOptions: AgentRuntimeExecutionOptions = {
  ...fullRuntimeOptions,
  permissionMode: "auto",
  permissionScope: "workspace",
  approvalReviewer: "automatic",
  permissionEscalation: "ask",
};

interface RecordedWrapCall extends WrapAcpAgentLaunchArgs {}

interface SandboxTestRuntimeArgs {
  events: ThreadEvent[];
  recordedCommands: AdapterCommand[];
  spawnedAdapters: string[];
  workspacePath: string;
  wrapCalls: RecordedWrapCall[];
  /** Omitted to model a runtime with no way to confine a bridge at all. */
  wrap?: (args: WrapAcpAgentLaunchArgs) => WrapAcpAgentLaunchResult;
}

/**
 * `/usr/bin/env` as the launcher: it runs `command args...` exactly as a
 * sandbox launcher does, so the prefix shape is the real one and the bridge
 * still starts. What it does not do is confine anything, which is why the
 * assertions below read the recorded call rather than probing the filesystem —
 * the sandbox itself is measured against the real backends in the daemon.
 */
function fakeSandboxLauncher(): WrapAcpAgentLaunchResult {
  return { sandboxed: true, launcher: { command: "/usr/bin/env", args: [] } };
}

function createSandboxTestRuntime(args: SandboxTestRuntimeArgs) {
  return createAgentRuntimeWithAdapters({
    workspacePath: args.workspacePath,
    onEvent: (event) => args.events.push(event),
    onToolCall: async () => ({ contentItems: [], success: true }),
    bridgeBundleDir: undefined,
    ...(args.wrap
      ? {
          wrapProviderProcessLaunch: (launch) => {
            args.wrapCalls.push(launch);
            return args.wrap!(launch);
          },
        }
      : {}),
    adapterFactory: (providerId) => {
      args.spawnedAdapters.push(providerId);
      const adapter = createFakeAdapter({ id: providerId });
      return {
        ...adapter,
        buildCommandPlan(command) {
          args.recordedCommands.push(command);
          return adapter.buildCommandPlan(command);
        },
      };
    },
  });
}

describe("a provider whose own bridge is the turn's boundary", () => {
  let workspacePath: string;
  let events: ThreadEvent[];
  let recordedCommands: AdapterCommand[];
  let spawnedAdapters: string[];
  let wrapCalls: RecordedWrapCall[];

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), "patcher-pi-sandbox-test-"));
    events = [];
    recordedCommands = [];
    spawnedAdapters = [];
    wrapCalls = [];
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it("confines the bridge of a workspace-scoped Pi turn, granting what Pi writes", async () => {
    const runtime = createSandboxTestRuntime({
      events,
      recordedCommands,
      spawnedAdapters,
      workspacePath,
      wrapCalls,
      wrap: fakeSandboxLauncher,
    });

    await runtime.startThread({
      environmentId: "env-1",
      projectId: "p1",
      threadId: "t1",
      providerId: "pi",
      options: workspaceScopedOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_111111111a",
      threadId: "t1",
      input: [promptTextInput({ text: "hello" })],
      options: workspaceScopedOptions,
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: "pi",
      runtime,
      text: "Response to: hello",
      threadId: "t1",
    });

    // The turn ran, so the launcher was really in front of the bridge rather
    // than only recorded: `/usr/bin/env node …` is what started it.
    expect(wrapCalls).toEqual([
      { cwd: workspacePath, stateDirs: PI_BRIDGE_STATE_DIRS },
    ]);
    await runtime.shutdown();
  });

  it("leaves a Full Access turn's bridge alone", async () => {
    const runtime = createSandboxTestRuntime({
      events,
      recordedCommands,
      spawnedAdapters,
      workspacePath,
      wrapCalls,
      wrap: fakeSandboxLauncher,
    });

    await runtime.startThread({
      environmentId: "env-1",
      projectId: "p1",
      threadId: "t1",
      providerId: "pi",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_111111111b",
      threadId: "t1",
      input: [promptTextInput({ text: "hello" })],
      options: fullRuntimeOptions,
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: "pi",
      runtime,
      text: "Response to: hello",
      threadId: "t1",
    });

    expect(wrapCalls).toEqual([]);
    await runtime.shutdown();
  });

  it("keeps the confined bridge and the unconfined one apart", async () => {
    const runtime = createSandboxTestRuntime({
      events,
      recordedCommands,
      spawnedAdapters,
      workspacePath,
      wrapCalls,
      wrap: fakeSandboxLauncher,
    });

    await runtime.startThread({
      environmentId: "env-1",
      projectId: "p1",
      threadId: "sandboxed",
      providerId: "pi",
      options: workspaceScopedOptions,
    });
    await runtime.startThread({
      environmentId: "env-1",
      projectId: "p1",
      threadId: "unconfined",
      providerId: "pi",
      options: fullRuntimeOptions,
    });

    // One process each: a thread at Full Access sharing the confined bridge
    // would be inside a boundary its mode says it is not, and a workspace turn
    // sharing the other one would be outside the boundary its mode promises.
    expect(spawnedAdapters).toEqual(["pi", "pi"]);
    expect(wrapCalls).toHaveLength(1);
    await runtime.shutdown();
  });

  it("refuses a workspace-scoped turn on a machine that cannot build a sandbox", async () => {
    const runtime = createSandboxTestRuntime({
      events,
      recordedCommands,
      spawnedAdapters,
      workspacePath,
      wrapCalls,
      wrap: () => ({
        sandboxed: false,
        reason: "bubblewrap is not installed",
        remedy: "install bubblewrap",
      }),
    });

    await expect(
      runtime.startThread({
        environmentId: "env-1",
        projectId: "p1",
        threadId: "t1",
        providerId: "pi",
        options: workspaceScopedOptions,
      }),
    ).rejects.toThrow(
      /bubblewrap is not installed.*install bubblewrap.*Full Access/s,
    );
    await runtime.shutdown();
  });

  it("refuses a workspace-scoped turn where nothing can confine a bridge", async () => {
    const runtime = createSandboxTestRuntime({
      events,
      recordedCommands,
      spawnedAdapters,
      workspacePath,
      wrapCalls,
    });

    await expect(
      runtime.startThread({
        environmentId: "env-1",
        projectId: "p1",
        threadId: "t1",
        providerId: "pi",
        options: workspaceScopedOptions,
      }),
    ).rejects.toThrow(/without a way to confine it.*Full Access/s);
    await runtime.shutdown();
  });

  it("moves a thread to the other bridge when its permission mode changes", async () => {
    const runtime = createSandboxTestRuntime({
      events,
      recordedCommands,
      spawnedAdapters,
      workspacePath,
      wrapCalls,
      wrap: fakeSandboxLauncher,
    });

    await runtime.startThread({
      environmentId: "env-1",
      projectId: "p1",
      threadId: "t1",
      providerId: "pi",
      options: workspaceScopedOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_111111111c",
      threadId: "t1",
      input: [promptTextInput({ text: "first" })],
      options: workspaceScopedOptions,
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: "pi",
      runtime,
      text: "Response to: first",
      threadId: "t1",
    });

    await runtime.runTurn({
      clientRequestId: "creq_111111111d",
      threadId: "t1",
      input: [promptTextInput({ text: "second" })],
      options: fullRuntimeOptions,
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: "pi",
      runtime,
      text: "Response to: second",
      threadId: "t1",
    });

    // Stopped on the bridge it left rather than discarded: `thread/discard`
    // deletes the Pi session file, which is what carries the history across.
    expect(
      findLastRecordedCommand(recordedCommands, "thread/stop"),
    ).toMatchObject({ threadId: "t1" });
    expect(
      findLastRecordedCommand(recordedCommands, "thread/resume"),
    ).toMatchObject({ threadId: "t1" });
    expect(spawnedAdapters).toEqual(["pi", "pi"]);
    expect(wrapCalls).toHaveLength(1);
    await runtime.shutdown();
  });

  it("refuses to change the boundary under a running turn", async () => {
    const runtime = createSandboxTestRuntime({
      events,
      recordedCommands,
      spawnedAdapters,
      workspacePath,
      wrapCalls,
      wrap: fakeSandboxLauncher,
    });

    await runtime.startThread({
      environmentId: "env-1",
      projectId: "p1",
      threadId: "t1",
      providerId: "pi",
      options: workspaceScopedOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_111111111e",
      threadId: "t1",
      input: [promptTextInput({ text: "delay:5000 slow" })],
      options: workspaceScopedOptions,
    });
    await waitForThreadTurnStarted({
      events,
      providerId: "pi",
      runtime,
      threadId: "t1",
    });
    const turnId = runtime.getActiveTurnId("t1");
    expect(turnId).not.toBeNull();

    // A mode changed in the composer travels with the steer. Moving the thread
    // now would mean either finishing the turn in the boundary it was told to
    // leave, or killing it without saying so.
    await expect(
      runtime.steerTurn({
        clientRequestId: "creq_111111111f",
        expectedTurnId: turnId ?? "",
        threadId: "t1",
        input: [promptTextInput({ text: "and now unconfined" })],
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow(/Stop the running turn first/);

    expect(wrapCalls).toHaveLength(1);
    await runtime.shutdown();
  });
});
