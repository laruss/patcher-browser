import type { PatcherPluginApi } from "@patcher/plugin-sdk";

export type AutomationSignalKind =
  | "automations-changed"
  | "automation-runs-changed";

export function publishAutomationChange(
  patcher: Pick<PatcherPluginApi, "realtime">,
  projectId: string,
  kinds: AutomationSignalKind | AutomationSignalKind[],
): void {
  for (const kind of Array.isArray(kinds) ? kinds : [kinds]) {
    patcher.realtime.publish("automations", { projectId, kind });
  }
}
