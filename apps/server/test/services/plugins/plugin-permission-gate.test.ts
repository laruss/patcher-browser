import { describe, expect, it, vi } from "vitest";
import type { PatcherSdk } from "@patcher/sdk";
import {
  applySdkPermissions,
  createPluginPermissionGate,
  PluginPermissionError,
} from "../../../src/services/plugins/plugin-permission-gate.js";

/**
 * The gate's own behaviour, away from a loaded plugin. What matters is that a
 * refusal names the missing permission — an agent that generated the plugin
 * has to be able to fix it from the message alone — and that a denied area is
 * unreachable rather than merely unusable.
 */
describe("createPluginPermissionGate", () => {
  it("denies everything when a plugin declared nothing", () => {
    const gate = createPluginPermissionGate("quiet", undefined);

    expect(gate.has("threads")).toBe(false);
    expect(gate.granted).toEqual([]);
    expect(() => gate.assert("threads", "patcher.sdk.threads.list")).toThrow(
      PluginPermissionError,
    );
  });

  it("names the permission and how to add it", () => {
    const gate = createPluginPermissionGate("noisy", ["tabs.read"]);

    expect(() =>
      gate.assert("page.credentials", 'patcher.browser command "page.storage"'),
    ).toThrow(
      /page\.storage.*"page\.credentials".*"noisy".*patcher\.permissions.*patcher plugin reload noisy/s,
    );
  });

  it("allows what was declared", () => {
    const gate = createPluginPermissionGate("noisy", ["tabs.read"]);

    expect(() =>
      gate.assert("tabs.read", "patcher.browser tabs.list"),
    ).not.toThrow();
  });

  // Declaration order is the plugin author's; the reported order is ours, so
  // two plugins with the same grants read the same in the list.
  it("reports the grants in one canonical order", () => {
    const gate = createPluginPermissionGate("x", [
      "threads",
      "tabs.read",
      "filesystem",
    ]);

    expect(gate.granted).toEqual(["tabs.read", "threads", "filesystem"]);
  });
});

describe("applySdkPermissions", () => {
  function fakeSdk() {
    return {
      files: { read: vi.fn(() => "contents") },
      terminals: { create: vi.fn() },
      threads: { list: vi.fn(() => []) },
      subscribe: vi.fn(() => () => {}),
    } as unknown as PatcherSdk;
  }

  it("passes through an area the plugin declared", () => {
    const gate = createPluginPermissionGate("p", ["filesystem"]);
    const sdk = applySdkPermissions(fakeSdk(), "p", gate);

    expect(sdk.files.read({} as never)).toBe("contents");
  });

  // Reaching the property throws, not just calling it: the stack then points
  // at the plugin's own line rather than inside the SDK.
  it("makes an undeclared area throw on the property read", () => {
    const gate = createPluginPermissionGate("p", ["filesystem"]);
    const sdk = applySdkPermissions(fakeSdk(), "p", gate);

    expect(() => sdk.terminals.create).toThrow(
      /patcher\.sdk\.terminals\.create needs the "shell" permission/,
    );
  });

  it("still answers symbol reads, so inspecting it does not explode", () => {
    const gate = createPluginPermissionGate("p", []);
    const sdk = applySdkPermissions(fakeSdk(), "p", gate);

    expect(() =>
      String(Object.prototype.toString.call(sdk.files)),
    ).not.toThrow();
  });

  // Two methods reach across areas, and both gates have to agree about them:
  // passing here and being refused by the HTTP gate is the worst of both.
  it("charges archiving an environment's threads to threads as well", () => {
    const sdk = {
      environments: { archiveThreads: vi.fn(() => "archived"), diff: vi.fn() },
    } as unknown as PatcherSdk;
    const workspaceOnly = applySdkPermissions(
      sdk,
      "p",
      createPluginPermissionGate("p", ["workspace"]),
    );

    expect(() => workspaceOnly.environments.diff({} as never)).not.toThrow();
    expect(() =>
      workspaceOnly.environments.archiveThreads({} as never),
    ).toThrow(/patcher\.sdk\.environments\.archiveThreads needs the "threads"/);
  });

  it("lets it through when both are declared", () => {
    const sdk = {
      environments: { archiveThreads: vi.fn(() => "archived") },
    } as unknown as PatcherSdk;
    const both = applySdkPermissions(
      sdk,
      "p",
      createPluginPermissionGate("p", ["workspace", "threads"]),
    );

    expect(both.environments.archiveThreads({} as never)).toBe("archived");
  });

  // threadSections.list reads /sidebar-bootstrap, which answers with every
  // project and its threads — the SDK keeps only the sections, but the whole
  // response crossed the boundary.
  it("charges listing thread sections to workspace as well", () => {
    const sdk = {
      threadSections: { list: vi.fn(() => []) },
    } as unknown as PatcherSdk;
    const threadsOnly = applySdkPermissions(
      sdk,
      "p",
      createPluginPermissionGate("p", ["threads"]),
    );

    expect(() => threadsOnly.threadSections.list()).toThrow(
      /needs the "workspace"/,
    );
  });

  // subscribe is one function whose argument picks the feed, so an area grant
  // cannot cover it: "workspace" must not buy a live view of the threads.
  it("charges thread events to threads, not to workspace", () => {
    const workspaceOnly = applySdkPermissions(
      fakeSdk(),
      "p",
      createPluginPermissionGate("p", ["workspace"]),
    );

    expect(() =>
      workspaceOnly.subscribe({ event: "host:changed", callback: () => {} }),
    ).not.toThrow();
    expect(() =>
      workspaceOnly.subscribe({ event: "thread:changed", callback: () => {} }),
    ).toThrow(/"threads" permission/);
  });
});
