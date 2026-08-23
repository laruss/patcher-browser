import type { PatcherPluginApi } from "@patcher/plugin-sdk";

export default function contentScriptExample(patcher: PatcherPluginApi) {
  patcher.log.info("Content script example loaded");
}
