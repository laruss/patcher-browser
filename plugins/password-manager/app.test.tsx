import { expect, it } from "vitest";
import { loadPluginApp } from "@patcher/plugin-sdk/testing/app";

it("does not add a per-site key or side panel", async () => {
  const app = await loadPluginApp(() => import("./app.js"));
  expect(app.browserToolbarPanels).toEqual([]);
  expect(app.leadingPanels).toEqual([]);
});
