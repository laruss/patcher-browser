import { assertNever } from "@patcher/core-ui";
import {
  pendingInteractionSchema,
  type PendingInteraction,
} from "@patcher/domain";
import type { PendingInteractionRow } from "@patcher/db";
import { ApiError } from "../../errors.js";

export class PendingInteractionSerializationError extends ApiError {
  readonly interactionId: string;
  readonly field: "payload" | "resolution";

  constructor(interactionId: string, field: "payload" | "resolution") {
    super(
      500,
      "internal_error",
      `Stored pending interaction ${field} is invalid`,
    );
    this.interactionId = interactionId;
    this.field = field;
  }
}

function parseStoredPendingInteractionJson(
  row: PendingInteractionRow,
  field: "payload" | "resolution",
): unknown {
  const value = field === "payload" ? row.payload : row.resolution;
  if (value === null) {
    throw new PendingInteractionSerializationError(row.id, field);
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new PendingInteractionSerializationError(row.id, field);
  }
}

function rowOrigin(row: PendingInteractionRow) {
  switch (row.originKind) {
    case "provider":
      return {
        kind: "provider",
        providerId: row.providerId,
        providerThreadId: row.providerThreadId,
        providerRequestId: row.providerRequestId,
      };
    case "plugin":
      return {
        kind: "plugin",
        pluginId: row.pluginId,
        rendererId: row.rendererId,
      };
    case "server":
      return { kind: "server" };
    default:
      // The column is TEXT with no CHECK, so the three cases above are a claim
      // about writers rather than something the database enforces. Falling off
      // the end would have returned `undefined` and blamed the payload.
      return assertNever(row.originKind);
  }
}

export function toPendingInteraction(
  row: PendingInteractionRow,
): PendingInteraction {
  let payload: unknown;
  try {
    payload = parseStoredPendingInteractionJson(row, "payload");
  } catch (error) {
    if (error instanceof PendingInteractionSerializationError) {
      throw error;
    }
    throw new PendingInteractionSerializationError(row.id, "payload");
  }

  let resolution: unknown;
  try {
    resolution =
      row.resolution === null
        ? null
        : parseStoredPendingInteractionJson(row, "resolution");
  } catch (error) {
    if (error instanceof PendingInteractionSerializationError) {
      throw error;
    }
    throw new PendingInteractionSerializationError(row.id, "resolution");
  }

  try {
    return pendingInteractionSchema.parse({
      id: row.id,
      threadId: row.threadId,
      turnId: row.turnId,
      ...(row.originKind === "provider"
        ? {
            providerId: row.providerId,
            providerThreadId: row.providerThreadId,
            providerRequestId: row.providerRequestId,
          }
        : {}),
      origin: rowOrigin(row),
      status: row.status,
      payload,
      resolution,
      statusReason: row.statusReason,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      resolvedAt: row.resolvedAt,
    });
  } catch {
    throw new PendingInteractionSerializationError(row.id, "payload");
  }
}
