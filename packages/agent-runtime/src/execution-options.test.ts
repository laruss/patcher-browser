import { describe, expect, it } from "vitest";
import type { RuntimeThreadExecutionOptions } from "@patcher/domain";
import {
  classifyClaudeExecutionSettingsChange,
  classifySessionExecutionSettingsChange,
  normalizeClaudeExecutionOptions,
} from "./execution-options.js";

const baseOptions = {
  model: "claude-opus-5[1m]",
  serviceTier: "default",
  reasoningLevel: "high",
  workflowsEnabled: true,
  memoryEnabled: true,
  providerSubagentsEnabled: true,
  permissionMode: "auto",
  permissionScope: "workspace",
  approvalReviewer: "automatic",
  permissionEscalation: "ask",
} satisfies RuntimeThreadExecutionOptions;

describe("execution setting classification", () => {
  it("classifies Claude turn-mutable settings as live", () => {
    const liveChanges: RuntimeThreadExecutionOptions[] = [
      { ...baseOptions, model: "claude-sonnet-5" },
      { ...baseOptions, reasoningLevel: "max" },
      { ...baseOptions, workflowsEnabled: false },
      { ...baseOptions, memoryEnabled: false },
      { ...baseOptions, providerSubagentsEnabled: false },
      { ...baseOptions, permissionEscalation: "deny" },
    ];

    for (const next of liveChanges) {
      expect(
        classifyClaudeExecutionSettingsChange({
          current: baseOptions,
          next,
        }),
      ).toBe("live");
    }
  });

  it("ignores Claude service-tier drift because Claude does not support tiers", () => {
    expect(
      classifyClaudeExecutionSettingsChange({
        current: baseOptions,
        next: { ...baseOptions, serviceTier: "fast" },
      }),
    ).toBe("unchanged");
  });

  it("normalizes Claude's unsupported fast service tier to default", () => {
    expect(
      normalizeClaudeExecutionOptions({
        ...baseOptions,
        serviceTier: "fast",
      }),
    ).toEqual(baseOptions);
    expect(normalizeClaudeExecutionOptions(baseOptions)).toBe(baseOptions);
  });

  it("keeps Claude construction-time settings session-scoped", () => {
    const sessionChanges: RuntimeThreadExecutionOptions[] = [
      { ...baseOptions, claudeCodePermissionMode: "plan" },
      {
        ...baseOptions,
        claudeCodeMockCliTraffic: {
          enabled: true,
          endpoint: "http://127.0.0.1:19001",
        },
      },
      {
        ...baseOptions,
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
    ];

    for (const next of sessionChanges) {
      expect(
        classifyClaudeExecutionSettingsChange({
          current: baseOptions,
          next,
        }),
      ).toBe("session");
    }
  });

  it("keeps setting changes session-scoped for adapters without live controls", () => {
    expect(
      classifySessionExecutionSettingsChange({
        current: baseOptions,
        next: { ...baseOptions, model: "another-model" },
      }),
    ).toBe("session");
  });

  it("restarts the session when the network setting changes", () => {
    // The permission profile carrying it is sent when a session starts, so a
    // change that did not restart one would sit there doing nothing until the
    // next session — the toggle would look broken rather than pending.
    expect(
      classifySessionExecutionSettingsChange({
        current: baseOptions,
        next: { ...baseOptions, providerNetworkRestricted: true },
      }),
    ).toBe("session");
    // Absent and false are the same answer: a command dispatched before the
    // field existed must not look like a change.
    expect(
      classifySessionExecutionSettingsChange({
        current: baseOptions,
        next: { ...baseOptions, providerNetworkRestricted: false },
      }),
    ).toBe("unchanged");
  });

  it("restarts the session when the egress boundary or its list changes", () => {
    // Same reason again: the launcher that names the proxy is built when the
    // provider process starts, so a list changed mid-session would apply to
    // nothing until something else happened to restart it.
    expect(
      classifySessionExecutionSettingsChange({
        current: baseOptions,
        next: { ...baseOptions, providerEgressConfined: true },
      }),
    ).toBe("session");
    expect(
      classifySessionExecutionSettingsChange({
        current: { ...baseOptions, providerEgressAllowedHosts: ["github.com"] },
        next: {
          ...baseOptions,
          providerEgressAllowedHosts: ["github.com", "pypi.org"],
        },
      }),
    ).toBe("session");
    // A list is a set written down: reordering it is not a change, and neither
    // is absent against empty.
    expect(
      classifySessionExecutionSettingsChange({
        current: {
          ...baseOptions,
          providerEgressAllowedHosts: ["github.com", "pypi.org"],
        },
        next: {
          ...baseOptions,
          providerEgressAllowedHosts: ["pypi.org", "github.com"],
        },
      }),
    ).toBe("unchanged");
    expect(
      classifySessionExecutionSettingsChange({
        current: baseOptions,
        next: { ...baseOptions, providerEgressAllowedHosts: [] },
      }),
    ).toBe("unchanged");
  });
});
