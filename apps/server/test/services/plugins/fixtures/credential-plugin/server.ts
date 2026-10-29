import type { PatcherPluginApi } from "@patcher/plugin-sdk";
export default function plugin(patcher: PatcherPluginApi) {
  patcher.browser.registerToolbarItem({
    id: "credential",
    title: "Save credential",
    async run(context) {
      const result = await patcher.browser.credentials.request({
        operation: "save",
        tabId: context.tabId,
        accountId: "primary",
      });
      await patcher.storage.kv.set("credential-result", result);
    },
  });
}
