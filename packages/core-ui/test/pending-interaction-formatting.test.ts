import { describe, expect, it } from "vitest";
import type {
  ConsentPendingInteractionPayload,
  PendingInteraction,
  PendingInteractionPayload,
} from "@patcher/domain";
import {
  buildPendingInteractionApprovalResolution,
  formatPendingInteractionConsentDetailLines,
  formatPendingInteractionConsentSummary,
  formatPendingInteractionApprovalResolutionOutcome,
  formatPendingInteractionSubjectDetailLines,
  summarizePendingInteractionRequestedPermissions,
} from "../src/index.js";

function createInteraction(
  payload: PendingInteractionPayload,
): PendingInteraction {
  return {
    id: "pint_123456789a",
    threadId: "thr_123",
    turnId: "turn_123",
    providerId: "codex",
    providerThreadId: "provider-thread-123",
    providerRequestId: "request-123",
    status: "pending",
    payload,
    resolution: null,
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
  };
}

describe("setup script consent copy", () => {
  const payload = {
    kind: "consent",
    action: "run-setup-script",
    subjectId: "a".repeat(64),
    subjectName: ".patcher-env-setup.sh",
    permissions: [],
    sites: [],
    detail:
      "/tmp/worktree/.patcher-env-setup.sh — 42 bytes, sha256 aaaaaaaaaaaa…",
  } as const satisfies ConsentPendingInteractionPayload;

  it("names the script rather than a plugin", () => {
    expect(formatPendingInteractionConsentSummary(payload)).toBe(
      "Run .patcher-env-setup.sh from this repository",
    );
  });

  it("says what running it means, and does not claim an agent asked", () => {
    // The plugin consents all end on "Asked for by an agent in this thread",
    // which is the one thing that is not true here: the person answering may be
    // the one who asked for the worktree.
    expect(formatPendingInteractionConsentDetailLines(payload)).toEqual([
      payload.detail,
      "Runs on the machine, outside any agent sandbox, as you.",
      // The scope is the answer: this repository, on this machine, for these
      // bytes. The same three characters in another checkout are another
      // script's worth of trust.
      "Allowing is remembered for this repository on this machine, until the script changes.",
    ]);
  });
});

describe("pending interaction formatting", () => {
  it("summarizes requested permissions consistently", () => {
    expect(
      summarizePendingInteractionRequestedPermissions({
        network: { enabled: true },
        fileSystem: {
          read: ["/tmp/read-a", "/tmp/read-b"],
          write: ["/tmp/write-a"],
        },
        macos: {
          preferences: "read_only",
          automations: "all",
          launchServices: true,
          accessibility: false,
          calendar: false,
          reminders: true,
          contacts: "none",
        },
      }),
    ).toEqual([
      "Network access",
      "Read 2 paths",
      "Write 1 path",
      "macOS launch services",
      "macOS reminders",
      "macOS preferences (read only)",
      "macOS automation (all apps)",
    ]);
  });

  it("formats approval outcomes consistently", () => {
    expect(
      formatPendingInteractionApprovalResolutionOutcome("allow_for_session"),
    ).toBe("approved for this session");
    expect(formatPendingInteractionApprovalResolutionOutcome("deny")).toBe(
      "denied",
    );
  });

  it("builds session approval resolutions with explicit command session grants", () => {
    const interaction = createInteraction({
      kind: "approval",
      subject: {
        kind: "command",
        itemId: "item_123",
        command: "curl https://example.com",
        cwd: "/tmp/project",
        actions: [{ type: "unknown", command: "curl https://example.com" }],
        sessionGrant: {
          network: { enabled: true },
          fileSystem: null,
        },
      },
      reason: "Needs network",
      availableDecisions: ["allow_once", "allow_for_session", "deny"],
    });

    expect(
      buildPendingInteractionApprovalResolution(
        interaction,
        "allow_for_session",
      ),
    ).toEqual({
      decision: "allow_for_session",
      grantedPermissions: {
        network: { enabled: true },
        fileSystem: null,
      },
    });

    expect(
      buildPendingInteractionApprovalResolution(interaction, "allow_once"),
    ).toEqual({
      decision: "allow_once",
      grantedPermissions: null,
    });

    expect(formatPendingInteractionSubjectDetailLines(interaction)).toEqual([
      "Command: curl https://example.com",
      "Cwd: /tmp/project",
      "Action: curl https://example.com",
      "Session grant: Network access",
    ]);
  });

  it("builds approval resolutions with explicit permission-grant permissions", () => {
    const interaction = createInteraction({
      kind: "approval",
      subject: {
        kind: "permission_grant",
        itemId: "item_123",
        toolName: "WebFetch",
        permissions: {
          network: { enabled: true },
          fileSystem: null,
        },
      },
      reason: "Needs network",
      availableDecisions: ["allow_once", "allow_for_session", "deny"],
    });

    expect(
      buildPendingInteractionApprovalResolution(interaction, "allow_once"),
    ).toEqual({
      decision: "allow_once",
      grantedPermissions: {
        network: { enabled: true },
        fileSystem: null,
      },
    });
  });
});
