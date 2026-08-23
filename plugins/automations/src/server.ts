import type { PatcherPluginApi } from "@patcher/plugin-sdk";
import { migrations } from "./data.js";
import { ingestLegacyImport } from "./legacy-import.js";
import { pluginDataDirFromDb } from "./path.js";
import { automationRpcContract, createRpcHandlers } from "./rpc.js";
import {
  closeAutomationRunForSettledThread,
  disableAutomationsForDeletedThreadEvent,
} from "./run.js";
import { registerAutomationCli } from "./cli.js";
import { createAutomationService } from "./service.js";
import { sleep, sweepDueAutomations, SWEEP_INTERVAL_MS } from "./sweep.js";

function resolveServerUrl(): string {
  return process.env.PATCHER_SERVER_URL?.trim() || "http://127.0.0.1:38986";
}

export default async function plugin(patcher: PatcherPluginApi) {
  const db = patcher.storage.database();
  patcher.storage.migrate(db, migrations);
  const pluginDataDir = pluginDataDirFromDb(db);
  await ingestLegacyImport({ patcher, db, pluginDataDir });

  const service = createAutomationService({
    patcher,
    db,
    pluginDataDir,
    serverUrl: resolveServerUrl(),
  });

  patcher.rpc.register(automationRpcContract, createRpcHandlers(service));
  registerAutomationCli({ patcher, service });

  patcher.events.on("thread.idle", ({ thread }) => {
    closeAutomationRunForSettledThread(patcher, db, {
      threadId: thread.id,
      status: "idle",
    });
  });
  patcher.events.on("thread.failed", ({ thread, error }) => {
    closeAutomationRunForSettledThread(patcher, db, {
      threadId: thread.id,
      status: "failed",
      error,
    });
  });

  patcher.events.on("thread.deleted", ({ thread }) => {
    disableAutomationsForDeletedThreadEvent(patcher, db, thread.id);
  });

  patcher.background.service("automation-sweep", {
    async start(signal) {
      while (!signal.aborted) {
        try {
          await sweepDueAutomations(patcher, db, {
            pluginDataDir,
            serverUrl: resolveServerUrl(),
          });
        } catch (error) {
          patcher.log.error(
            `Automation sweep failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        await sleep(SWEEP_INTERVAL_MS, signal);
      }
    },
  });
}
