import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  pluginPermissionsFromManifest,
} from "@patcher/plugin-sdk/testing";
import type {
  PluginAgentConfigurationContext,
  PluginAgentToolResult,
} from "@patcher/plugin-sdk";
import plugin from "./server.js";
import { BROWSER_TOOL_NAMES } from "./tools.js";

/**
 * The tools are thin over `patcher.browser`, so what is worth asserting is the part
 * that is not: which commands each tool issues, and what the model is told when
 * the browser refuses. A wrong message here reads to an agent as a broken
 * browser rather than as a recoverable situation.
 */

function configurationContext(): PluginAgentConfigurationContext {
  return {
    thread: {
      id: "thr-test",
      title: null,
      parentThreadId: null,
      sourceThreadId: null,
    },
    project: {
      id: "proj-test",
      kind: "standard",
      name: "Patcher",
      gitRemoteUrl: null,
    },
    environment: {
      id: "env-test",
      name: null,
      path: null,
      workspaceProvisionType: "unmanaged",
      branchName: null,
    },
    host: { id: "host-test", name: "local" },
    provider: { id: "codex", model: "test-model" },
    origin: { kind: null, pluginId: null },
  };
}

function createHost() {
  const host = createFakePluginHost({
    permissions: pluginPermissionsFromManifest(import.meta.url),
    pluginId: "browser-tools",
  });
  plugin(host.patcher);
  host.harness.behavior.browser.setTabs([
    { tabId: "tab-1", url: "https://example.com/", title: "Example" },
    { tabId: "tab-2", url: "https://other.test/", title: "Other", live: false },
  ]);
  host.harness.behavior.browser.setPageContent("tab-1", {
    text: "The page text.",
    selection: "page",
    snapshot: '- button "Save" [ref=e1]',
  });
  return host;
}

function textOf(result: PluginAgentToolResult): string {
  if (typeof result === "string") {
    return result;
  }
  return result.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

function isError(result: PluginAgentToolResult): boolean {
  return typeof result !== "string" && result.isError === true;
}

describe("browser-tools registration", () => {
  it("registers every tool under a name the host accepts", () => {
    const host = createHost();
    const registered = host.harness.inspection.registrations.agentTools.map(
      (tool) => tool.name,
    );

    expect(registered.sort()).toEqual([...BROWSER_TOOL_NAMES].sort());
    // The host's own pattern: dots are rejected, which is why the plan's
    // `browser.tabs.list` is spelled with underscores here.
    for (const name of registered) {
      expect(name).toMatch(/^[a-zA-Z0-9_-]+$/u);
    }
  });

  it("offers all of them, with instructions, on every thread", async () => {
    const host = createHost();
    const configuration = await host.harness.resolveAgentConfiguration(
      configurationContext(),
    );

    expect(configuration.tools.map((tool) => tool.name).sort()).toEqual(
      [...BROWSER_TOOL_NAMES].sort(),
    );
    // Advertising unconditionally matters: the tool set is baked into a provider
    // session at thread start, so gating on "is a browser open right now" would
    // strand a user who opens the browser mid-thread.
    expect(configuration.instructions ?? "").not.toBe("");
    expect((configuration.instructions ?? "").length).toBeLessThanOrEqual(4096);
  });
});

describe("browser-tools happy paths", () => {
  it("lists tabs with their liveness", async () => {
    const host = createHost();

    const result = await host.harness.behavior.callAgentTool(
      "browser_tabs_list",
      {},
    );

    const parsed = JSON.parse(textOf(result)) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ tabId: "tab-1", hasLivePage: true });
    expect(parsed[1]).toMatchObject({ tabId: "tab-2", hasLivePage: false });
  });

  it("opens, activates and closes tabs", async () => {
    const host = createHost();

    await host.harness.behavior.callAgentTool("browser_tabs_open", {
      url: "https://new.test/",
    });
    await host.harness.behavior.callAgentTool("browser_tabs_activate", {
      tabId: "tab-2",
    });
    const closed = await host.harness.behavior.callAgentTool(
      "browser_tabs_close",
      { tabId: "tab-1" },
    );

    expect(textOf(closed)).toContain("Closed tab-1");
    expect(
      host.harness.inspection.browserCalls.map((call) => call.type),
    ).toEqual(["tabs.open", "tabs.activate", "tabs.close"]);
  });

  it("labels page text as page-authored content", async () => {
    const host = createHost();

    const result = await host.harness.behavior.callAgentTool(
      "browser_page_get_text",
      { tabId: "tab-1" },
    );

    // The boundary is the whole mitigation for prompt injection out of a page:
    // there is nothing to sanitize, so the text is delimited and labelled.
    expect(textOf(result)).toContain("written by the page");
    expect(textOf(result)).toContain("The page text.");
    expect(isError(result)).toBe(false);
  });

  it("labels the snapshot as page-authored and counts its refs", async () => {
    const host = createHost();

    const result = await host.harness.behavior.callAgentTool(
      "browser_snapshot",
      { tabId: "tab-1" },
    );

    expect(isError(result)).toBe(false);
    expect(textOf(result)).toContain('- button "Save" [ref=e1]');
    expect(textOf(result)).toContain("1 interactive element");
    // Roles and labels are the page's words too, so they carry the same warning
    // the text read does.
    expect(textOf(result)).toContain("written by the page");
  });

  it("tells the agent DevTools is holding a tab it cannot snapshot", async () => {
    const host = createHost();
    host.harness.behavior.browser.failNextCall("debugger_unavailable");

    const result = await host.harness.behavior.callAgentTool(
      "browser_snapshot",
      { tabId: "tab-1" },
    );

    expect(isError(result)).toBe(true);
    expect(textOf(result)).toContain("DevTools");
  });

  it("answers a dialog, and says plainly when there was none", async () => {
    const host = createHost();
    host.harness.behavior.browser.setPendingDialog(true);

    const answered = await host.harness.behavior.callAgentTool(
      "browser_handle_dialog",
      { tabId: "tab-1", accept: true },
    );
    expect(isError(answered)).toBe(false);
    expect(textOf(answered)).toContain("accepted");

    // Nothing waiting is not a failure — the user may have clicked it first.
    const none = await host.harness.behavior.callAgentTool(
      "browser_handle_dialog",
      { tabId: "tab-1", accept: false },
    );
    expect(isError(none)).toBe(false);
    expect(textOf(none)).toContain("no dialog waiting");
  });

  it("reports an empty selection as a fact, not a failure", async () => {
    const host = createHost();
    host.harness.behavior.browser.setPageContent("tab-1", { selection: "" });

    const result = await host.harness.behavior.callAgentTool(
      "browser_page_get_selection",
      { tabId: "tab-1" },
    );

    expect(isError(result)).toBe(false);
    expect(textOf(result)).toContain("Nothing is selected");
  });

  it("navigates and reports the tab afterwards", async () => {
    const host = createHost();

    const result = await host.harness.behavior.callAgentTool(
      "browser_navigation_open",
      { url: "https://example.com/next", tabId: "tab-1" },
    );

    expect(JSON.parse(textOf(result))).toMatchObject({
      tabId: "tab-1",
      url: "https://example.com/next",
    });
  });
});

describe("browser-tools failure messages", () => {
  it("tells the agent to activate a tab that has no live page", async () => {
    const host = createHost();

    const result = await host.harness.behavior.callAgentTool(
      "browser_page_get_text",
      { tabId: "tab-2" },
    );

    expect(isError(result)).toBe(true);
    expect(textOf(result)).toContain("Activate it");
  });

  it("tells the agent to ask the user when no browser window is open", async () => {
    const host = createHost();
    host.harness.behavior.browser.setConnected(false);

    const result = await host.harness.behavior.callAgentTool(
      "browser_tabs_list",
      {},
    );

    expect(isError(result)).toBe(true);
    expect(textOf(result)).toContain("open the Patcher desktop app");
  });

  it("explains a refused URL instead of silently searching for it", async () => {
    const host = createHost();
    host.harness.behavior.browser.failNextCall("blocked_url");

    const result = await host.harness.behavior.callAgentTool(
      "browser_navigation_open",
      { url: "javascript:alert(1)" },
    );

    expect(isError(result)).toBe(true);
    expect(textOf(result)).toContain("http and https");
  });

  it("names the unknown tab problem so the agent can re-list", async () => {
    const host = createHost();
    host.harness.behavior.browser.failNextCall("unknown_tab");

    const result = await host.harness.behavior.callAgentTool(
      "browser_tabs_activate",
      { tabId: "gone" },
    );

    expect(isError(result)).toBe(true);
    expect(textOf(result)).toContain("List the tabs");
  });

  it("says an older desktop build cannot read pages", async () => {
    const host = createHost();
    host.harness.behavior.browser.failNextCall("unsupported_command");

    const result = await host.harness.behavior.callAgentTool(
      "browser_page_get_text",
      { tabId: "tab-1" },
    );

    expect(isError(result)).toBe(true);
    expect(textOf(result)).toContain("update");
  });
});

describe("browser-tools interaction", () => {
  it("clicks the ref it was given, defaulting the rest", async () => {
    const host = createHost();

    const result = await host.harness.behavior.callAgentTool("browser_click", {
      tabId: "tab-1",
      ref: "e1",
    });

    expect(isError(result)).toBe(false);
    expect(host.harness.inspection.browserCalls.at(-1)).toEqual({
      type: "page.act",
      args: {
        tabId: "tab-1",
        generation: undefined,
        action: {
          action: "click",
          ref: "e1",
          button: "left",
          clickCount: 1,
          modifiers: [],
        },
      },
    });
    // The reminder is the point: refs from before the click may no longer mean
    // what they did, and re-using them is the mistake that follows an action.
    expect(textOf(result)).toContain("Snapshot again");
  });

  it("turns doubleClick into the click count Chromium wants", async () => {
    const host = createHost();

    await host.harness.behavior.callAgentTool("browser_click", {
      tabId: "tab-1",
      ref: "e1",
      doubleClick: true,
      button: "right",
      modifiers: ["Shift"],
    });

    expect(host.harness.inspection.browserCalls.at(-1)?.args).toMatchObject({
      action: {
        button: "right",
        clickCount: 2,
        modifiers: ["Shift"],
      },
    });
  });

  it("passes a generation through so a reassigned ref is refused", async () => {
    const host = createHost();

    await host.harness.behavior.callAgentTool("browser_fill", {
      tabId: "tab-1",
      ref: "e1",
      text: "hello",
      generation: 4,
    });

    expect(host.harness.inspection.browserCalls.at(-1)?.args).toMatchObject({
      generation: 4,
      action: { action: "fill", ref: "e1", text: "hello" },
    });
  });

  it("presses a key with no element when none was named", async () => {
    const host = createHost();

    await host.harness.behavior.callAgentTool("browser_press", {
      tabId: "tab-1",
      key: "Enter",
    });

    // The key goes wherever the page has focus, so `ref` must be absent rather
    // than present-and-empty.
    expect(host.harness.inspection.browserCalls.at(-1)?.args).toEqual({
      tabId: "tab-1",
      generation: undefined,
      action: { action: "press", key: "Enter" },
    });
  });

  it("tells the agent to re-snapshot when a ref has gone stale", async () => {
    const host = createHost();
    host.harness.behavior.browser.failNextCall("stale_refs");

    const result = await host.harness.behavior.callAgentTool("browser_click", {
      tabId: "tab-1",
      ref: "e1",
    });

    expect(isError(result)).toBe(true);
    expect(textOf(result)).toContain("fresh snapshot");
  });

  it("passes on why an element could not be acted on", async () => {
    const host = createHost();
    host.harness.behavior.browser.failNextCall(
      "not_actionable",
      "Gave up waiting for the element: something else is on top of it.",
    );

    const result = await host.harness.behavior.callAgentTool("browser_click", {
      tabId: "tab-1",
      ref: "e1",
    });

    expect(isError(result)).toBe(true);
    // "covered" is a different fix from "disabled", so the reason has to survive
    // the trip rather than collapsing into a generic failure.
    expect(textOf(result)).toContain("on top of it");
  });

  it("names the key names it accepts when given one it does not", async () => {
    const host = createHost();
    host.harness.behavior.browser.failNextCall("unsupported_key");

    const result = await host.harness.behavior.callAgentTool("browser_press", {
      tabId: "tab-1",
      key: "Frobnicate",
    });

    expect(isError(result)).toBe(true);
    expect(textOf(result)).toContain("Enter");
  });
});

describe("browser-tools observation", () => {
  it("hands the screenshot back as an image the model can look at", async () => {
    const host = createHost();

    const result = await host.harness.behavior.callAgentTool(
      "browser_screenshot",
      { tabId: "tab-1" },
    );

    expect(isError(result)).toBe(false);
    // The image itself rather than a path to it: a model that asked to see the
    // page has to see it in the same turn, and it cannot open a file.
    const parts = typeof result === "string" ? [] : result.content;
    expect(parts.map((part) => part.type)).toEqual(["text", "image"]);
    const image = parts.find((part) => part.type === "image");
    expect(image).toMatchObject({ mimeType: "image/jpeg" });
    expect(textOf(result)).toContain("https://example.com/");
    expect(host.harness.inspection.browserCalls.at(-1)).toEqual({
      type: "page.screenshot",
      args: { tabId: "tab-1", fullPage: false },
    });
  });

  it("captures the whole document when asked, and says which it captured", async () => {
    const host = createHost();

    const result = await host.harness.behavior.callAgentTool(
      "browser_screenshot",
      { tabId: "tab-1", fullPage: true },
    );

    expect(isError(result)).toBe(false);
    // The picture cannot say whether it is a viewport or a document, so the
    // text beside it has to: a model told "viewport" of a full-page capture
    // would scroll and shoot again for nothing.
    expect(textOf(result)).toContain("Whole page");
    expect(host.harness.inspection.browserCalls.at(-1)).toEqual({
      type: "page.screenshot",
      args: { tabId: "tab-1", fullPage: true },
    });
  });

  it("explains a capture that was too large without pretending it returned one", async () => {
    const host = createHost();
    host.harness.behavior.browser.failNextCall(
      "result_too_large",
      "That page's PDF is 40MB, past what the browser bridge will carry.",
    );

    const result = await host.harness.behavior.callAgentTool(
      "browser_screenshot",
      { tabId: "tab-1" },
    );

    expect(isError(result)).toBe(true);
    expect(textOf(result)).toContain("40MB");
    expect(textOf(result)).toContain("Nothing partial");
  });
});
