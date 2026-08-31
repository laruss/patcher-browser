import type { CommandExecutionRequestApprovalResponse } from "./generated/codex-app-server/schema/v2/CommandExecutionRequestApprovalResponse.js";
import type { FileChangeRequestApprovalResponse } from "./generated/codex-app-server/schema/v2/FileChangeRequestApprovalResponse.js";
import type { PermissionsRequestApprovalResponse } from "./generated/codex-app-server/schema/v2/PermissionsRequestApprovalResponse.js";
import type {
  BuildInteractiveResponseArgs,
  DecodedInteractiveRequest,
} from "../provider-adapter.js";
import type { ProviderInboundRequest } from "../runtime-json-rpc.js";
import {
  ProviderRequestDecodeError as ProviderRequestDecodeErrorValue,
  ProviderResponseEncodeError,
} from "../runtime-json-rpc.js";
import {
  parseCodexAvailableDecisions,
  pendingInteractionToCodexFileChangeApprovalDecision,
  toCodexCommandApprovalDecision,
  toCodexGrantedPermissionProfile,
  toPendingInteractionGrantablePermissionProfile,
} from "./permission-mapping.js";
import {
  CODEX_MCP_TOOL_CALL_APPROVAL_KIND,
  codexCommandExecutionRequestApprovalParamsSchema,
  codexFileChangeRequestApprovalParamsSchema,
  codexMcpServerElicitationRequestParamsSchema,
  codexPermissionsRequestApprovalParamsSchema,
} from "./schemas.js";
import type {
  PendingInteractionApprovalDecision,
  PendingInteractionGrantablePermissionProfile,
} from "@patcher/domain";
import {
  isApprovalPendingInteractionPayload,
  isApprovalPendingInteractionResolution,
} from "@patcher/domain";

/**
 * The answer an MCP elicitation takes, which is not shaped like the others.
 *
 * `{ action, content }` rather than `{ decision }` — measured: a `{ decision }`
 * body is refused by Codex with "missing field `action`", and the tool call then
 * comes back failed with "user rejected MCP tool call". There is no generated
 * type for it in `generated/`, so it is written here.
 */
export type CodexMcpServerElicitationResponse = {
  action: "accept" | "decline";
  content: Record<string, never>;
};

export type CodexInteractiveResponse =
  | CommandExecutionRequestApprovalResponse
  | FileChangeRequestApprovalResponse
  | PermissionsRequestApprovalResponse
  | CodexMcpServerElicitationResponse;

function assertNever(value: never, message?: string): never {
  throw new ProviderResponseEncodeError(
    message ?? `Unexpected value: ${String(value)}`,
  );
}

function requireGrantedPermissions(
  args: Extract<
    BuildInteractiveResponseArgs["resolution"],
    { decision: "allow_once" | "allow_for_session" }
  >,
) {
  if (args.grantedPermissions === null) {
    throw new ProviderResponseEncodeError(
      "Permission grant approval must include granted permissions",
    );
  }
  return args.grantedPermissions;
}

function hasGrantablePermissions(
  permissions: PendingInteractionGrantablePermissionProfile | null,
): boolean {
  const fileSystem = permissions?.fileSystem ?? null;
  return (
    permissions?.network?.enabled === true ||
    (fileSystem !== null &&
      (fileSystem.read.length > 0 || fileSystem.write.length > 0))
  );
}

function filterSessionDecisionWithoutGrant(
  decisions: PendingInteractionApprovalDecision[],
  sessionGrant: PendingInteractionGrantablePermissionProfile | null,
): PendingInteractionApprovalDecision[] {
  if (hasGrantablePermissions(sessionGrant)) {
    return decisions;
  }

  const filtered = decisions.filter(
    (decision) => decision !== "allow_for_session",
  );
  if (filtered.length === 0) {
    throw new ProviderRequestDecodeErrorValue(
      "Approval request did not include decisions compatible with the requested permissions",
    );
  }
  return filtered;
}

export function decodeCodexInteractiveRequest(
  request: ProviderInboundRequest,
): DecodedInteractiveRequest | null {
  if (typeof request.id !== "string" && typeof request.id !== "number") {
    return null;
  }

  switch (request.method) {
    case "item/commandExecution/requestApproval": {
      const parsed = codexCommandExecutionRequestApprovalParamsSchema.safeParse(
        request.params,
      );
      if (!parsed.success) {
        return null;
      }
      const availableDecisions = parseCodexAvailableDecisions(
        parsed.data.availableDecisions,
      );
      if (!parsed.data.command) {
        throw new ProviderRequestDecodeErrorValue(
          "Command approval request did not include a command subject",
        );
      }
      const sessionGrant = parsed.data.additionalPermissions
        ? toPendingInteractionGrantablePermissionProfile(
            parsed.data.additionalPermissions,
          )
        : null;
      return {
        requestId: request.id,
        method: request.method,
        providerThreadId: parsed.data.threadId,
        turnId: parsed.data.turnId,
        payload: {
          kind: "approval",
          subject: {
            kind: "command",
            itemId: parsed.data.itemId,
            command: parsed.data.command,
            cwd: parsed.data.cwd ?? null,
            actions: parsed.data.commandActions ?? [],
            sessionGrant: hasGrantablePermissions(sessionGrant)
              ? sessionGrant
              : null,
          },
          reason: parsed.data.reason ?? null,
          availableDecisions: filterSessionDecisionWithoutGrant(
            availableDecisions,
            sessionGrant,
          ),
        },
      };
    }
    case "item/fileChange/requestApproval": {
      const parsed = codexFileChangeRequestApprovalParamsSchema.safeParse(
        request.params,
      );
      if (!parsed.success) {
        return null;
      }
      const sessionGrant: PendingInteractionGrantablePermissionProfile | null =
        parsed.data.grantRoot
          ? {
              network: null,
              fileSystem: {
                read: [],
                write: [parsed.data.grantRoot],
              },
            }
          : null;
      return {
        requestId: request.id,
        method: request.method,
        providerThreadId: parsed.data.threadId,
        turnId: parsed.data.turnId,
        payload: {
          kind: "approval",
          subject: {
            kind: "file_change",
            itemId: parsed.data.itemId,
            writeScope: parsed.data.grantRoot ?? null,
            sessionGrant,
          },
          reason: parsed.data.reason ?? null,
          availableDecisions: filterSessionDecisionWithoutGrant(
            ["allow_once", "allow_for_session", "deny"],
            sessionGrant,
          ),
        },
      };
    }
    case "item/permissions/requestApproval": {
      const parsed = codexPermissionsRequestApprovalParamsSchema.safeParse(
        request.params,
      );
      if (!parsed.success) {
        return null;
      }
      const permissions = toPendingInteractionGrantablePermissionProfile(
        parsed.data.permissions,
      );
      return {
        requestId: request.id,
        method: request.method,
        providerThreadId: parsed.data.threadId,
        turnId: parsed.data.turnId,
        payload: {
          kind: "approval",
          subject: {
            kind: "permission_grant",
            itemId: parsed.data.itemId,
            toolName: null,
            permissions,
          },
          reason: parsed.data.reason,
          availableDecisions: ["allow_once", "allow_for_session", "deny"],
        },
      };
    }
    case "mcpServer/elicitation/request": {
      const parsed = codexMcpServerElicitationRequestParamsSchema.safeParse(
        request.params,
      );
      if (!parsed.success) {
        return null;
      }
      // Only a tool-call approval. The same method also carries a genuine
      // elicitation — a server asking the person for input against
      // `requestedSchema` — and answering one of those with "allowed" would be
      // returning an empty form as if it were filled in.
      if (
        parsed.data._meta?.codex_approval_kind !==
        CODEX_MCP_TOOL_CALL_APPROVAL_KIND
      ) {
        return null;
      }
      const toolDescription = parsed.data._meta?.tool_description ?? null;
      return {
        requestId: request.id,
        method: request.method,
        providerThreadId: parsed.data.threadId,
        turnId: parsed.data.turnId,
        payload: {
          kind: "approval",
          subject: {
            kind: "mcp_tool_call",
            serverName: parsed.data.serverName,
            message: parsed.data.message,
            toolDescription:
              toolDescription !== null && toolDescription.length > 0
                ? toolDescription
                : null,
          },
          reason: null,
          // No `allow_for_session`: the wire advertises the scope and the shape
          // of an answer that persists is unmeasured, so offering it would
          // record a decision the next call does not honour.
          availableDecisions: ["allow_once", "deny"],
        },
      };
    }
    default:
      return null;
  }
}

export function buildCodexInteractiveResponse(
  args: BuildInteractiveResponseArgs,
): CodexInteractiveResponse {
  if (
    !isApprovalPendingInteractionPayload(args.request.payload) ||
    !isApprovalPendingInteractionResolution(args.resolution)
  ) {
    throw new ProviderResponseEncodeError(
      "Codex user-question interactive requests are unsupported",
    );
  }

  switch (args.request.payload.subject.kind) {
    case "command": {
      const response: CommandExecutionRequestApprovalResponse = {
        decision: toCodexCommandApprovalDecision(args.resolution.decision),
      };
      return response;
    }
    case "file_change": {
      const response: FileChangeRequestApprovalResponse = {
        decision:
          pendingInteractionToCodexFileChangeApprovalDecision[
            args.resolution.decision
          ],
      };
      return response;
    }
    case "permission_grant": {
      if (args.resolution.decision === "deny") {
        const response: PermissionsRequestApprovalResponse = {
          permissions: {},
          scope: "turn",
        };
        return response;
      }
      const response: PermissionsRequestApprovalResponse = {
        permissions: toCodexGrantedPermissionProfile(
          requireGrantedPermissions(args.resolution),
        ),
        scope:
          args.resolution.decision === "allow_for_session" ? "session" : "turn",
      };
      return response;
    }
    case "mcp_tool_call": {
      const response: CodexMcpServerElicitationResponse = {
        action: args.resolution.decision === "deny" ? "decline" : "accept",
        content: {},
      };
      return response;
    }
    // Plan review is Claude's ExitPlanMode approval; Codex never raises one.
    case "plan":
      throw new ProviderResponseEncodeError(
        "Codex plan-review interactive requests are unsupported",
      );
    default:
      return assertNever(args.request.payload.subject);
  }
}
