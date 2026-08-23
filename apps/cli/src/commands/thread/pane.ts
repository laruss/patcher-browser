import { Command } from "commander";
import { threadPaneActionSchema } from "@patcher/server-contract";
import { action } from "../../action.js";
import { createCliPatcherSdk } from "../../client.js";
import {
  resolveContextThreadId,
  resolveExplicitIdFlag,
} from "../../context-env.js";
import { outputJson, printContextLabel, type ResolvedId } from "../helpers.js";

interface ThreadPaneCommandOptions {
  json?: boolean;
}

function resolveThreadPaneTarget(id: string | undefined): ResolvedId {
  const explicit = resolveExplicitIdFlag({
    flagName: "<threadId> argument",
    value: id,
  });
  if (explicit !== undefined) {
    return { id: explicit, source: "arg" };
  }
  const context = resolveContextThreadId();
  if (context !== undefined) {
    return { id: context, source: "env" };
  }
  throw new Error(
    "Missing thread ID. Pass <threadId> or run inside a Patcher thread.",
  );
}

export function registerPaneCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("pane")
    .description("Maximize or restore a thread pane in connected Patcher apps")
    .usage("<maximize|restore|toggle> [id] [options]")
    .argument("<action>", "Pane action: maximize, restore, or toggle")
    .argument("[id]", "Thread ID. Omit inside a Patcher thread.")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          actionInput: string,
          id: string | undefined,
          opts: ThreadPaneCommandOptions,
        ) => {
          const paneAction = threadPaneActionSchema.parse(actionInput);
          const target = resolveThreadPaneTarget(id);
          const result = await createCliPatcherSdk(getUrl()).threads.paneAction(
            {
              action: paneAction,
              threadId: target.id,
            },
          );
          if (
            outputJson(opts, {
              threadId: target.id,
              action: paneAction,
              delivered: result.delivered,
            })
          ) {
            return;
          }
          printContextLabel(target, "Thread", "PATCHER_THREAD_ID", opts);
          console.log(`Thread: ${target.id}`);
          console.log(`Pane action: ${paneAction}`);
          console.log(`Delivered: ${result.delivered}`);
        },
      ),
    );
}
