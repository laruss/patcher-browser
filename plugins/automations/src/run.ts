import type { PatcherPluginApi } from "@patcher/plugin-sdk";
import { z } from "zod";
import {
  closeAutomationRun,
  disableAutomationsForDeletedThread,
  getAutomation,
  getRunningAutomationRunByThread,
  markAutomationThread,
  setAutomationEnabled,
  setAutomationRunThread,
  type AutomationRow,
  type AutomationRunRow,
  type Db,
} from "./data.js";
import { publishAutomationChange } from "./realtime.js";
import { executeStoredScript, mapScriptResultToRun } from "./script-runner.js";
import type { AutomationExecution } from "./rpc-types.js";

export type RunFailureHandler = (error: unknown) => void;
type AgentThreadsSdk = {
  get(args: Parameters<PatcherPluginApi["sdk"]["threads"]["get"]>[0]): Promise<unknown>;
  send(args: Parameters<PatcherPluginApi["sdk"]["threads"]["send"]>[0]): Promise<unknown>;
  spawn(args: Parameters<PatcherPluginApi["sdk"]["threads"]["spawn"]>[0]): Promise<unknown>;
};
type AgentRunApi = Pick<PatcherPluginApi, "realtime" | "log"> & {
  sdk: { threads: AgentThreadsSdk };
};

const sdkThreadSchema = z
  .object({
    id: z.string(),
    archivedAt: z.number().nullable(),
    deletedAt: z.number().nullable(),
    status: z.enum(["idle", "active", "starting", "stopping", "error"]),
  })
  .passthrough();
type SdkThread = z.infer<typeof sdkThreadSchema>;

const projectGoneErrorSchema = z
  .object({
    status: z.literal(404),
    code: z.enum(["project_not_found", "project_unavailable"]),
  })
  .passthrough();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Thread creation rejects 404 project_not_found/project_unavailable when the
 * automation's project was deleted. Detected structurally (the SDK's
 * PatcherHttpError carries status + code) because the bundled plugin cannot
 * instanceof-match the host's error class.
 */
function isProjectGoneError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return projectGoneErrorSchema.safeParse(error).success;
}

function renderAutomationDueMessage(args: {
  automationId: string;
  prompt: string;
}): string {
  return `[Patcher automation due:${args.automationId}]\n\n${args.prompt}`;
}

function isThreadReusable(thread: SdkThread): boolean {
  return (
    thread.deletedAt === null &&
    thread.archivedAt === null &&
    (thread.status === "idle" || thread.status === "active")
  );
}

interface AgentRunArgs {
  automation: AutomationRow;
  run: AutomationRunRow;
  execution: Extract<AutomationExecution, { mode: "agent" }>;
  onFailure: RunFailureHandler;
}

export async function executeAgentRun(
  patcher: AgentRunApi,
  db: Db,
  args: AgentRunArgs,
): Promise<void> {
  try {
    if (args.automation.targetThreadId !== null) {
      await reuseTargetThreadForRun(patcher, db, {
        ...args,
        targetThreadId: args.automation.targetThreadId,
      });
      return;
    }
    const thread = sdkThreadSchema.parse(
      await patcher.sdk.threads.spawn({
        projectId: args.automation.projectId,
        environment: args.execution.environment,
        prompt: args.execution.prompt,
        title: args.automation.name,
        providerId: args.execution.providerId,
        model: args.execution.model,
        permissionMode: args.execution.permissionMode,
      }),
    );
    setAutomationRunThread(db, { runId: args.run.id, threadId: thread.id });
    markAutomationThread(db, {
      automationId: args.automation.id,
      runId: args.run.id,
      threadId: thread.id,
      now: Date.now(),
    });
  } catch (error) {
    settleDispatchFailure(patcher, db, args, error);
  } finally {
    publishAutomationChange(patcher, args.automation.projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
  }
}

/**
 * Failure policy for agent dispatch: a deleted project is terminal (the
 * project never comes back), so disable the automation and close the run
 * instead of invoking the caller's rollback — which would re-arm the past
 * next_run_at and fail again every sweep.
 */
function settleDispatchFailure(
  patcher: Pick<PatcherPluginApi, "log">,
  db: Db,
  args: AgentRunArgs,
  error: unknown,
): void {
  const message = errorMessage(error);
  if (isProjectGoneError(error)) {
    setAutomationEnabled(db, {
      projectId: args.automation.projectId,
      automationId: args.automation.id,
      enabled: false,
      nextRunAt: null,
      lastError: message,
    });
    closeAutomationRun(db, {
      runId: args.run.id,
      status: "failed",
      error: message,
      now: Date.now(),
    });
  } else {
    args.onFailure(error);
  }
  patcher.log.error(
    `Failed to dispatch automation ${args.automation.id}: ${message}`,
  );
}

async function reuseTargetThreadForRun(
  patcher: AgentRunApi,
  db: Db,
  args: AgentRunArgs & { targetThreadId: string },
): Promise<void> {
  let thread: SdkThread;
  try {
    thread = sdkThreadSchema.parse(
      await patcher.sdk.threads.get({ threadId: args.targetThreadId }),
    );
  } catch (error) {
    closeRunForUnusableTargetThread(patcher, db, {
      ...args,
      detail: errorMessage(error),
    });
    return;
  }

  if (!isThreadReusable(thread)) {
    closeRunForUnusableTargetThread(patcher, db, {
      ...args,
      detail: "missing, deleted, archived, or not runnable",
    });
    return;
  }

  setAutomationRunThread(db, {
    runId: args.run.id,
    threadId: args.targetThreadId,
  });
  markAutomationThread(db, {
    automationId: args.automation.id,
    runId: args.run.id,
    threadId: args.targetThreadId,
    now: Date.now(),
  });
  await patcher.sdk.threads.send({
    threadId: args.targetThreadId,
    mode: "steer-if-active",
    input: [
      {
        type: "text",
        text: renderAutomationDueMessage({
          automationId: args.automation.id,
          prompt: args.execution.prompt,
        }),
        mentions: [],
      },
    ],
    permissionMode: args.execution.permissionMode,
  });
}

/**
 * The target thread is gone or unusable — a deliberate disable, not a
 * transient dispatch failure: close the run failed and leave the automation
 * disabled instead of invoking the schedule rollback (which would re-enable
 * and re-arm it).
 */
function closeRunForUnusableTargetThread(
  patcher: Pick<PatcherPluginApi, "log">,
  db: Db,
  args: AgentRunArgs & { targetThreadId: string; detail: string },
): void {
  const now = Date.now();
  disableAutomationsForDeletedThread(db, {
    threadId: args.targetThreadId,
    now,
  });
  closeAutomationRun(db, {
    runId: args.run.id,
    status: "failed",
    error: `Target thread ${args.targetThreadId} is unavailable: ${args.detail}`,
    now,
  });
  patcher.log.error(
    `Automation ${args.automation.id} target thread ${args.targetThreadId} is unavailable: ${args.detail}`,
  );
}

export async function executeScriptRun(
  patcher: Pick<PatcherPluginApi, "realtime" | "log">,
  db: Db,
  args: {
    pluginDataDir: string;
    automation: AutomationRow;
    run: AutomationRunRow;
    execution: Extract<AutomationExecution, { mode: "script" }>;
    onFailure: RunFailureHandler;
    serverUrl: string;
  },
): Promise<void> {
  try {
    const scriptFile = args.execution.scriptFile;
    if (scriptFile === undefined) {
      closeAutomationRun(db, {
        runId: args.run.id,
        status: "failed",
        error: "Script automation is missing a stored script file",
        now: Date.now(),
      });
      return;
    }
    const result = await executeStoredScript({
      pluginDataDir: args.pluginDataDir,
      automationId: args.automation.id,
      runId: args.run.id,
      projectId: args.automation.projectId,
      scriptFile,
      interpreter: args.execution.interpreter,
      timeoutMs: args.execution.timeoutMs,
      env: args.execution.env,
      serverUrl: args.serverUrl,
    });
    const mapped = mapScriptResultToRun(result);
    // Close with the completion time, not dispatch time — scripts run for
    // up to 15 minutes and the duration surfaces in the run history.
    closeAutomationRun(db, {
      runId: args.run.id,
      status: mapped.status,
      skipReason: mapped.skipReason,
      output: mapped.output,
      exitCode: mapped.exitCode,
      error: mapped.error,
      now: Date.now(),
    });
  } catch (error) {
    args.onFailure(error);
    patcher.log.error(
      `Failed to run script for automation ${args.automation.id}: ${errorMessage(error)}`,
    );
  } finally {
    publishAutomationChange(patcher, args.automation.projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
  }
}

export function closeAutomationRunForSettledThread(
  patcher: Pick<PatcherPluginApi, "realtime">,
  db: Db,
  args: { threadId: string; status: "idle" | "failed"; error?: string | null },
): void {
  const run = getRunningAutomationRunByThread(db, args.threadId);
  if (!run) return;
  const closed = closeAutomationRun(db, {
    runId: run.id,
    status: args.status === "idle" ? "succeeded" : "failed",
    error: args.status === "idle" ? null : (args.error ?? "Turn failed"),
    threadId: args.threadId,
    now: Date.now(),
  });
  if (!closed) return;
  const automation = getAutomation(db, closed.automationId);
  if (automation) {
    publishAutomationChange(patcher, automation.projectId, [
      "automations-changed",
      "automation-runs-changed",
    ]);
  }
}

export function disableAutomationsForDeletedThreadEvent(
  patcher: Pick<PatcherPluginApi, "realtime">,
  db: Db,
  threadId: string,
): void {
  const disabled = disableAutomationsForDeletedThread(db, {
    threadId,
    now: Date.now(),
  });
  for (const automation of disabled) {
    publishAutomationChange(patcher, automation.projectId, "automations-changed");
  }
}
