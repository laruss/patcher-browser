import type {
  ConsentPendingInteractionPayload,
  PendingInteractionApprovalDecision,
  PendingInteractionCommandAction,
  PendingInteractionGrantablePermissionProfile,
  PendingInteractionGrantedPermissionProfile,
  PendingInteractionMacOsPermissions,
  PendingInteraction,
  PendingInteractionResolution,
  PendingInteractionRequestedPermissionProfile,
} from "@patcher/domain";
import {
  isApprovalPendingInteractionPayload,
  isConsentPendingInteractionPayload,
} from "@patcher/domain";
import { assertNever } from "./assert-never.js";

/**
 * One line naming the change, in the imperative — the same voice the plugin
 * settings toggle uses, so the prompt reads as the action the user is being
 * asked to take rather than as a report about an agent.
 */
export function formatPendingInteractionConsentSummary(
  payload: ConsentPendingInteractionPayload,
): string {
  switch (payload.action) {
    case "enable":
      return `Enable the ${payload.subjectName} plugin`;
    case "disable":
      return `Disable the ${payload.subjectName} plugin`;
    case "install":
      return `Install a plugin from ${payload.subjectName}`;
    case "update":
      return `Update the ${payload.subjectName} plugin`;
    case "remove":
      return `Remove the ${payload.subjectName} plugin`;
    case "configure":
      return `Change the ${payload.subjectName} plugin's settings`;
    case "run-setup-script":
      return `Run ${payload.subjectName} from this repository`;
    case "move-workspace":
      return `Move this thread to ${payload.subjectName}`;
    case "reach-host":
      return `Let this turn reach ${payload.subjectName}`;
    case "browser-external-access":
      // Named for who gains it rather than for the setting, because the setting
      // is the mechanism and "agents outside Patcher" is the decision.
      return payload.subjectId === "off"
        ? "Stop letting agents outside Patcher use the browser"
        : `Let agents outside Patcher use the browser: ${payload.subjectName}`;
    default:
      return assertNever(payload.action);
  }
}

export function formatPendingInteractionConsentDetailLines(
  payload: ConsentPendingInteractionPayload,
): string[] {
  // The setup script is the one consent here that is not about a plugin and not
  // necessarily about an agent's request, so it says what running it means and
  // does not claim anybody asked. It also says that the answer is kept: an
  // allow is remembered against this machine, this checkout and this script's
  // content, so "Allow" is not a one-off and the prompt has to admit it — and it
  // is those three together, because the same bytes in another repository are
  // another script's worth of trust.
  // A folder outside the project is a folder outside every sandbox this project
  // builds, so the prompt says what the answer widens rather than only where.
  if (payload.action === "move-workspace") {
    return [
      ...(payload.detail === null ? [] : [payload.detail]),
      "Every turn after this one may write anywhere inside that folder.",
      "Asked for by an agent in this thread.",
    ];
  }
  if (payload.action === "run-setup-script") {
    return [
      ...(payload.detail === null ? [] : [payload.detail]),
      "Runs on the machine, outside any agent sandbox, as you.",
      "Allowing is remembered for this repository on this machine, until the script changes.",
    ];
  }
  // The one consent that is answered while something waits on it: the agent's
  // connection is open while this is on screen. So the lines say what the
  // answer covers and that it is kept — an answer that were not kept would put
  // the same question back on screen on the agent's next retry.
  if (payload.action === "reach-host") {
    return [
      ...(payload.detail === null ? [] : [payload.detail]),
      "Everything else this turn sends off the machine still goes through Patcher, checked against its list.",
      "Either answer is remembered for this workspace's turns until Patcher restarts. Add the host in Settings to keep it for good.",
    ];
  }
  // The one consent whose beneficiary is not the agent asking. Every other
  // action here changes what *this* turn's Patcher does; this one opens the
  // browser to Claude Code, Codex or a script running in a terminal, and a
  // prompt that did not say so would read as the agent asking for itself.
  if (payload.action === "browser-external-access") {
    return [
      ...(payload.detail === null ? [] : [payload.detail]),
      ...(payload.permissions.length > 0
        ? [`Allows: ${payload.permissions.join(", ")}`]
        : []),
      "Applies to agents and terminals outside Patcher, not to this thread. Threads here are gated by the browser-tools plugin, and this answer does not turn that plugin on.",
      "Change it any time in Settings → General → Agents outside Patcher.",
      "Asked for by an agent in this thread.",
    ];
  }
  // On enable, install, update and configure the list is what saying yes hands
  // over. On disable and remove it is what the plugin holds today and saying yes
  // takes away, so the same "Permissions:" label would read as a grant request
  // for the two actions that grant nothing.
  const revokes = payload.action === "disable" || payload.action === "remove";
  return [
    ...(payload.permissions.length > 0
      ? [
          `${revokes ? "Currently allowed" : "Permissions"}: ${payload.permissions.join(", ")}`,
        ]
      : []),
    ...(payload.sites.length > 0
      ? [
          `${revokes ? "Currently reaches" : "Sites"}: ${payload.sites.join(", ")}`,
        ]
      : []),
    ...(payload.detail === null ? [] : [payload.detail]),
    "Asked for by an agent in this thread.",
  ];
}

type PendingInteractionPermissionSummaryProfile =
  | PendingInteractionGrantablePermissionProfile
  | PendingInteractionRequestedPermissionProfile;

function summarizeRequestedMacOsPermissions(
  permissions: PendingInteractionMacOsPermissions | null,
): string[] {
  if (permissions === null) {
    return [];
  }

  const summaries: string[] = [];
  if (permissions.accessibility) {
    summaries.push("macOS accessibility");
  }
  if (permissions.launchServices) {
    summaries.push("macOS launch services");
  }
  if (permissions.calendar) {
    summaries.push("macOS calendar");
  }
  if (permissions.reminders) {
    summaries.push("macOS reminders");
  }
  if (permissions.preferences !== "none") {
    summaries.push(
      `macOS preferences (${permissions.preferences.replace("_", " ")})`,
    );
  }
  if (permissions.contacts !== "none") {
    summaries.push(
      `macOS contacts (${permissions.contacts.replace("_", " ")})`,
    );
  }
  if (permissions.automations === "all") {
    summaries.push("macOS automation (all apps)");
  } else if (
    permissions.automations !== "none" &&
    permissions.automations.bundleIds.length > 0
  ) {
    summaries.push(
      permissions.automations.bundleIds.length === 1
        ? "macOS automation (1 app)"
        : `macOS automation (${permissions.automations.bundleIds.length} apps)`,
    );
  }

  return summaries;
}

export function summarizePendingInteractionRequestedPermissions(
  permissions: PendingInteractionPermissionSummaryProfile,
): string[] {
  const summaries: string[] = [];
  if (permissions.network?.enabled === true) {
    summaries.push("Network access");
  }
  if (permissions.fileSystem) {
    if (permissions.fileSystem.read.length > 0) {
      summaries.push(
        permissions.fileSystem.read.length === 1
          ? "Read 1 path"
          : `Read ${permissions.fileSystem.read.length} paths`,
      );
    }
    if (permissions.fileSystem.write.length > 0) {
      summaries.push(
        permissions.fileSystem.write.length === 1
          ? "Write 1 path"
          : `Write ${permissions.fileSystem.write.length} paths`,
      );
    }
  }

  return [
    ...summaries,
    ...summarizeRequestedMacOsPermissions(
      "macos" in permissions ? permissions.macos : null,
    ),
  ];
}

function summarizeCommandActions(
  actions: PendingInteractionCommandAction[],
): string[] {
  return actions.map((action) => {
    switch (action.type) {
      case "read":
        return `Read ${action.path}`;
      case "listFiles":
        return action.path ? `List files in ${action.path}` : "List files";
      case "search":
        return action.query
          ? `Search for ${action.query}${action.path ? ` in ${action.path}` : ""}`
          : action.path
            ? `Search in ${action.path}`
            : "Search files";
      case "unknown":
        return action.command;
      default:
        return assertNever(action);
    }
  });
}

function formatPermissionSummaryLine(
  label: string,
  permissions: PendingInteractionGrantablePermissionProfile | null,
): string | null {
  if (permissions === null) {
    return null;
  }
  const summaries =
    summarizePendingInteractionRequestedPermissions(permissions);
  return summaries.length > 0 ? `${label}: ${summaries.join(", ")}` : null;
}

export function formatPendingInteractionSubjectDetailLines(
  interaction: PendingInteraction,
): string[] {
  if (interaction.payload.kind === "plugin") {
    return [];
  }
  if (isConsentPendingInteractionPayload(interaction.payload)) {
    return formatPendingInteractionConsentDetailLines(interaction.payload);
  }
  if (!isApprovalPendingInteractionPayload(interaction.payload)) {
    return interaction.payload.questions.map((question) => question.prompt);
  }
  switch (interaction.payload.subject.kind) {
    case "command": {
      const actionLines = summarizeCommandActions(
        interaction.payload.subject.actions,
      ).map((action) => `Action: ${action}`);
      const sessionGrant = formatPermissionSummaryLine(
        "Session grant",
        interaction.payload.subject.sessionGrant,
      );
      return [
        `Command: ${interaction.payload.subject.command}`,
        ...(interaction.payload.subject.cwd
          ? [`Cwd: ${interaction.payload.subject.cwd}`]
          : []),
        ...actionLines,
        ...(sessionGrant ? [sessionGrant] : []),
      ];
    }
    case "file_change": {
      const sessionGrant = formatPermissionSummaryLine(
        "Session grant",
        interaction.payload.subject.sessionGrant,
      );
      return [
        `Item: ${interaction.payload.subject.itemId}`,
        ...(interaction.payload.subject.writeScope
          ? [`Write root: ${interaction.payload.subject.writeScope}`]
          : []),
        ...(sessionGrant ? [sessionGrant] : []),
      ];
    }
    case "permission_grant": {
      const permissions = summarizePendingInteractionRequestedPermissions(
        interaction.payload.subject.permissions,
      );
      return [
        ...(interaction.payload.subject.toolName
          ? [`Tool: ${interaction.payload.subject.toolName}`]
          : []),
        ...permissions.map((permission) => `Permission: ${permission}`),
      ];
    }
    case "plan": {
      // The plan body is the subject, not a detail line. Surfaces render it
      // themselves so they can keep its Markdown; this only names the file.
      return interaction.payload.subject.planFilePath
        ? [`Plan file: ${interaction.payload.subject.planFilePath}`]
        : [];
    }
    case "mcp_tool_call": {
      // The question itself is the summary; these are what a person needs to
      // judge it — which server, and what the server says the tool does.
      return [
        `MCP server: ${interaction.payload.subject.serverName}`,
        ...(interaction.payload.subject.toolDescription
          ? [`Tool: ${interaction.payload.subject.toolDescription}`]
          : []),
      ];
    }
    default:
      return assertNever(interaction.payload.subject);
  }
}

function toGrantedPermissions(
  permissions: PendingInteractionPermissionSummaryProfile,
): PendingInteractionGrantedPermissionProfile {
  return {
    network: permissions.network?.enabled === true ? { enabled: true } : null,
    fileSystem: permissions.fileSystem
      ? {
          read: permissions.fileSystem.read,
          write: permissions.fileSystem.write,
        }
      : null,
  };
}

export function formatPendingInteractionApprovalResolutionOutcome(
  decision: PendingInteractionApprovalDecision,
): string {
  switch (decision) {
    case "allow_once":
      return "approved";
    case "allow_for_session":
      return "approved for this session";
    case "deny":
      return "denied";
    default:
      return assertNever(decision);
  }
}

function resolveGrantedPermissionsForApproval(
  interaction: PendingInteraction,
  decision: PendingInteractionApprovalDecision,
): PendingInteractionGrantedPermissionProfile | null {
  if (!isApprovalPendingInteractionPayload(interaction.payload)) {
    return null;
  }
  if (interaction.payload.subject.kind === "permission_grant") {
    return toGrantedPermissions(interaction.payload.subject.permissions);
  }

  if (decision !== "allow_for_session") {
    return null;
  }

  if (
    interaction.payload.subject.kind === "command" ||
    interaction.payload.subject.kind === "file_change"
  ) {
    return interaction.payload.subject.sessionGrant;
  }

  // A plan verdict carries no grant.
  return null;
}

export function buildPendingInteractionApprovalResolution(
  interaction: PendingInteraction,
  decision: PendingInteractionApprovalDecision,
): PendingInteractionResolution {
  if (decision === "deny") {
    return {
      decision,
    };
  }

  return {
    decision,
    grantedPermissions: resolveGrantedPermissionsForApproval(
      interaction,
      decision,
    ),
  };
}
