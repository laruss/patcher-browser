import type { TimelineConversationTurnRequest } from "@patcher/server-contract";

export function turnRequestLabel(
  turnRequest: TimelineConversationTurnRequest,
): string | null {
  if (turnRequest.kind !== "steer") {
    return null;
  }
  return turnRequest.status === "pending" ? "Steer pending" : "Steer";
}
