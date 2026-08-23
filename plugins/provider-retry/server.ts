import type { PatcherPluginApi } from "@patcher/plugin-sdk";
import { registerProviderRetryCli } from "./src/cli.js";
import { providerRetryRpcContract } from "./src/contract.js";
import {
  DEFAULT_MAXIMUM_WAIT_MS,
  ProviderRetryService,
} from "./src/service.js";

const MAXIMUM_WAIT_OPTIONS = ["6 hours", "24 hours", "No limit"] as const;

function maximumWaitMs(value: string | boolean | undefined): number | null {
  switch (value) {
    case "6 hours":
      return DEFAULT_MAXIMUM_WAIT_MS;
    case "24 hours":
      return 24 * 60 * 60 * 1_000;
    case "No limit":
      return null;
    default:
      throw new Error(
        `Unsupported maximum provider retry wait: ${String(value)}`,
      );
  }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function logFailure(
  patcher: PatcherPluginApi,
  operation: string,
  error: unknown,
): void {
  patcher.log.warn(
    `${operation}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

export default async function plugin(patcher: PatcherPluginApi) {
  const settings = patcher.settings.define({
    maximumWait: {
      type: "select",
      label: "Maximum automatic wait",
      description:
        "Do not schedule a retry when the reported reset is farther away than this.",
      options: [...MAXIMUM_WAIT_OPTIONS],
      default: "6 hours",
    },
  });
  const initialSettings = await settings.get();
  const service = new ProviderRetryService(
    patcher,
    undefined,
    maximumWaitMs(initialSettings.maximumWait),
  );
  settings.onChange((next) => {
    service.setMaximumWaitMs(maximumWaitMs(next.maximumWait));
  });
  patcher.onDispose(() => service.dispose());

  patcher.rpc.register(providerRetryRpcContract, {
    providerRetryCancel({ threadId }) {
      return { cancelled: service.cancel(threadId) };
    },
    providerRetryStatus({ threadId }) {
      return { view: service.status(threadId) };
    },
  });
  registerProviderRetryCli(patcher, service);

  patcher.events.on("thread.failed", async ({ thread }) => {
    try {
      await service.reconcile(thread.id);
    } catch (error) {
      logFailure(
        patcher,
        `Could not inspect provider retry for ${thread.id}`,
        error,
      );
    }
  });
  patcher.events.on("thread.active", ({ thread }) =>
    service.supersede(thread.id),
  );
  patcher.events.on("thread.idle", ({ thread }) =>
    service.supersede(thread.id),
  );
  patcher.events.on("thread.archived", ({ thread }) =>
    service.supersede(thread.id),
  );
  patcher.events.on("thread.deleted", ({ thread }) =>
    service.supersede(thread.id),
  );

  patcher.background.service("provider-retry-scheduler", {
    async start(signal) {
      const unsubscribeHost = patcher.sdk.subscribe({
        event: "host:changed",
        callback: (event) => {
          if (
            event.id !== undefined &&
            event.changes.includes("host-connected")
          ) {
            service.hostChanged(event.id);
          }
        },
      });
      try {
        await waitForAbort(signal);
      } finally {
        unsubscribeHost();
      }
    },
  });
}
