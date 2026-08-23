import type { PatcherPluginApi } from "@patcher/plugin-sdk";
import type { TasksApiStore } from "../api";
import type { TaskThread, TaskThreadLiveStatus } from "../db";
import {
  createSystemComment,
  publishCommentsChanged,
  publishThreadsChanged,
} from "../delegate";

const TERMINAL_LIVE_STATUSES = new Set<TaskThreadLiveStatus>([
  "completed",
  "failed",
]);
export const THREAD_STATUS_RECONCILE_INTERVAL_MS = 5 * 60_000;
export const THREAD_STATUS_IDLE_INTERVAL_MS = 60_000;

type SdkThread = Awaited<ReturnType<PatcherPluginApi["sdk"]["threads"]["get"]>>;

function liveStatusFromThread(thread: SdkThread): TaskThreadLiveStatus {
  if (thread.status === "error") return "failed";
  if (thread.deletedAt !== null) return "completed";

  switch (thread.status) {
    case "starting":
      return "starting";
    case "active":
    case "stopping":
      return "working";
    case "idle":
      return "idle";
  }
}

function trackedThreads(store: TasksApiStore, threadId?: string): TaskThread[] {
  const tracked: TaskThread[] = [];
  for (const task of store.tasks.listTasks()) {
    for (const thread of store.tasks.listTaskThreads(task.id)) {
      if (threadId === undefined || thread.threadId === threadId) {
        tracked.push(thread);
      }
    }
  }
  return tracked;
}

function terminalCommentBody(
  thread: TaskThread,
  liveStatus: Extract<TaskThreadLiveStatus, "completed" | "failed">,
): string {
  return `Thread "${thread.title}" ${liveStatus} — final message posted · ${thread.threadId}`;
}

function sdkErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function transitionThread(
  patcher: PatcherPluginApi,
  store: TasksApiStore,
  thread: TaskThread,
  liveStatus: TaskThreadLiveStatus,
): void {
  if (
    thread.liveStatus === liveStatus ||
    TERMINAL_LIVE_STATUSES.has(thread.liveStatus)
  ) {
    return;
  }

  store.transaction(() => {
    store.tasks.updateTaskThreadStatus(thread.id, liveStatus);
    if (liveStatus === "completed" || liveStatus === "failed") {
      createSystemComment(store.tasks, {
        taskId: thread.taskId,
        presetName: thread.presetName,
        threadId: thread.threadId,
        body: terminalCommentBody(thread, liveStatus),
      });
    }
  });

  publishThreadsChanged(patcher, thread.taskId);
  publishCommentsChanged(patcher, thread.taskId);
}

function transitionTrackedThread(
  patcher: PatcherPluginApi,
  store: TasksApiStore,
  threadId: string,
  liveStatus: TaskThreadLiveStatus,
): void {
  for (const thread of trackedThreads(store, threadId)) {
    transitionThread(patcher, store, thread, liveStatus);
  }
}

async function reconcileTrackedThread(
  patcher: PatcherPluginApi,
  store: TasksApiStore,
  trackedThread: TaskThread,
): Promise<void> {
  try {
    const thread = await patcher.sdk.threads.get({
      threadId: trackedThread.threadId,
    });
    transitionThread(
      patcher,
      store,
      trackedThread,
      liveStatusFromThread(thread),
    );
  } catch (error) {
    if (sdkErrorCode(error) === "thread_not_found") {
      transitionThread(patcher, store, trackedThread, "completed");
      return;
    }
    patcher.log.warn(
      `Could not reconcile task thread ${trackedThread.threadId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function reconcileTrackedThreads(
  patcher: PatcherPluginApi,
  store: TasksApiStore,
): Promise<void> {
  const nonTerminalThreads = trackedThreads(store).filter(
    (thread) => !TERMINAL_LIVE_STATUSES.has(thread.liveStatus),
  );

  for (const trackedThread of nonTerminalThreads) {
    await reconcileTrackedThread(patcher, store, trackedThread);
  }
}

function hasNonTerminalTrackedThreads(store: TasksApiStore): boolean {
  return trackedThreads(store).some(
    (thread) => !TERMINAL_LIVE_STATUSES.has(thread.liveStatus),
  );
}

function waitForNextReconciliation(
  signal: AbortSignal,
  intervalMs: number,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, intervalMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function registerLifecycle(
  patcher: PatcherPluginApi,
  store: TasksApiStore,
): Promise<void> {
  patcher.events.on("thread.created", ({ thread }) => {
    transitionTrackedThread(
      patcher,
      store,
      thread.id,
      liveStatusFromThread(thread),
    );
  });
  patcher.events.on("thread.active", ({ thread }) => {
    transitionTrackedThread(patcher, store, thread.id, "working");
  });
  patcher.events.on("thread.idle", ({ thread }) => {
    transitionTrackedThread(patcher, store, thread.id, "idle");
  });
  patcher.events.on("thread.failed", ({ thread }) => {
    transitionTrackedThread(patcher, store, thread.id, "failed");
  });
  patcher.events.on("thread.deleted", ({ thread }) => {
    transitionTrackedThread(patcher, store, thread.id, "completed");
  });

  // Lifecycle events cover live transitions without a full-SDK subscription.
  // Reconciliation remains a low-frequency recovery path for transitions that
  // happen while the plugin is unloaded or while a replacement is loading.
  patcher.background.service("thread-status-reconcile", {
    async start(signal) {
      while (!signal.aborted) {
        if (!hasNonTerminalTrackedThreads(store)) {
          await waitForNextReconciliation(
            signal,
            THREAD_STATUS_IDLE_INTERVAL_MS,
          );
          continue;
        }
        await waitForNextReconciliation(
          signal,
          THREAD_STATUS_RECONCILE_INTERVAL_MS,
        );
        if (signal.aborted) break;
        await reconcileTrackedThreads(patcher, store);
      }
    },
  });

  await reconcileTrackedThreads(patcher, store);
  await reconcileTrackedThreads(patcher, store);
}
