import { defineRpcContract, type PatcherPluginApi } from "@patcher/plugin-sdk";
import { z } from "zod";

import { createStore, registerTasksApi } from "./api";
import { registerAttachments } from "./attachments";
import { registerTasksCli } from "./cli";
import { registerDelegation } from "./delegate";
import { registerLifecycle } from "./lifecycle";
import { registerMentions } from "./mentions";

export const TASKS_PLUGIN_NAME = "Tasks";
export const TASKS_PLUGIN_VERSION = "0.1.1";

export const tasksRpcContract = defineRpcContract({
  ping: {
    input: z.null(),
    output: z.object({ ok: z.literal(true), version: z.string() }),
  },
});

function statusPayload() {
  return { name: TASKS_PLUGIN_NAME, version: TASKS_PLUGIN_VERSION };
}

export default async function plugin(patcher: PatcherPluginApi) {
  patcher.log.info(`${TASKS_PLUGIN_NAME} ${TASKS_PLUGIN_VERSION} loaded`);

  const store = createStore(patcher);
  registerTasksApi(patcher, store);
  registerAttachments(patcher, store.tasks);
  registerTasksCli(patcher, store, statusPayload());
  registerDelegation(patcher, store);
  registerMentions(patcher, store);
  await registerLifecycle(patcher, store);

  patcher.rpc.register(tasksRpcContract, {
    ping(): { ok: true; version: string } {
      return { ok: true, version: TASKS_PLUGIN_VERSION };
    },
  });
}
