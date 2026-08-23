import { describe, expect, it } from "vitest";
import {
  BROWSER_COMMAND_MAX_ZOOM_FACTOR,
  BROWSER_COMMAND_MIN_ZOOM_FACTOR,
} from "@patcher/domain";
import { createFakePluginHost } from "../fake-plugin-host.js";

/**
 * What the double may not do is accept a call the host refuses: a plugin that
 * learns "zoom clamps" from its own passing tests ships a call that fails in the
 * app, and the failure surfaces in someone else's browser. The range itself is
 * the command schema's, imported here rather than repeated, so moving it moves
 * this test with it.
 */
async function zoomTo(factor: number): Promise<number> {
  const { patcher } = createFakePluginHost({
    pluginId: "p",
    permissions: ["tabs.modify", "page.interact"],
  });
  await patcher.browser.tabs.open({ url: "https://example.test/" });
  return await patcher.browser.page.zoom({ factor });
}

describe("the fake host's page.zoom", () => {
  it("takes a factor inside the range the host accepts", async () => {
    await expect(zoomTo(1.25)).resolves.toBe(1.25);
    await expect(zoomTo(BROWSER_COMMAND_MIN_ZOOM_FACTOR)).resolves.toBe(
      BROWSER_COMMAND_MIN_ZOOM_FACTOR,
    );
    await expect(zoomTo(BROWSER_COMMAND_MAX_ZOOM_FACTOR)).resolves.toBe(
      BROWSER_COMMAND_MAX_ZOOM_FACTOR,
    );
  });

  it("refuses one outside it rather than clamping", async () => {
    await expect(zoomTo(BROWSER_COMMAND_MAX_ZOOM_FACTOR + 0.1)).rejects.toThrow(
      /outside the accepted/,
    );
    await expect(zoomTo(BROWSER_COMMAND_MIN_ZOOM_FACTOR - 0.1)).rejects.toThrow(
      /outside the accepted/,
    );
  });
});
