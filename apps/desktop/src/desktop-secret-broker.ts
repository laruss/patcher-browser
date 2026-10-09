import type { Duplex } from "node:stream";
import { z } from "zod";
import {
  PrivateSecretChannel,
  SecretStorageError,
  secretStorageCode,
  SECRET_NAMESPACE,
} from "@patcher/secret-storage";
import {
  desktopSecretStorageStatusSchema,
  type DesktopSecretStorageStatus,
} from "@patcher/desktop-contract";

export interface DesktopKeyBackend {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}
const keyPayload = z
  .object({ storeId: z.uuid(), key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/) })
  .strict();
const wrappedPayload = keyPayload
  .extend({ version: z.literal(1), purpose: z.literal(SECRET_NAMESPACE) })
  .strict();
const envelopeSchema = z
  .object({
    version: z.literal(1),
    storeId: z.uuid(),
    wrappedKey: z
      .string()
      .min(1)
      .max(12000)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
  })
  .strict();
const unavailable = (
  error: DesktopSecretStorageStatus["error"],
): DesktopSecretStorageStatus => ({
  mode: "plaintext",
  available: false,
  migrationPending: false,
  unprocessedEntries: 0,
  error,
});

export function createDesktopSecretBroker(
  stream: Duplex,
  backend: DesktopKeyBackend,
) {
  let allowed = true;
  let server = false;
  let epoch = 0;
  let lastStatus = unavailable("unavailable");
  const peer = new PrivateSecretChannel(stream, {
    request(method, payload, signal) {
      if (signal.aborted || !allowed || !backend.available())
        throw new SecretStorageError("locked");
      const generation = epoch;
      try {
        if (method === "wrap") {
          const result = keyPayload.safeParse(payload);
          if (!result.success) throw new SecretStorageError("invalid_request");
          const encrypted = backend.encrypt(
            JSON.stringify({
              version: 1,
              purpose: SECRET_NAMESPACE,
              ...result.data,
            }),
          );
          if (generation !== epoch || signal.aborted)
            throw new SecretStorageError("cancelled");
          return Promise.resolve(encrypted.toString("base64"));
        }
        if (method === "unwrap") {
          const envelope = envelopeSchema.safeParse(payload);
          if (!envelope.success)
            throw new SecretStorageError("invalid_request");
          const raw = backend.decrypt(
            Buffer.from(envelope.data.wrappedKey, "base64"),
          );
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            throw new SecretStorageError("corrupt");
          }
          const result = wrappedPayload.safeParse(parsed);
          if (!result.success || result.data.storeId !== envelope.data.storeId)
            throw new SecretStorageError("corrupt");
          if (generation !== epoch || signal.aborted)
            throw new SecretStorageError("cancelled");
          return Promise.resolve(result.data.key);
        }
        throw new SecretStorageError("invalid_request");
      } catch (error) {
        throw error instanceof SecretStorageError
          ? error
          : new SecretStorageError("locked");
      }
    },
    notice(name, value) {
      if (name === "server") server = value;
    },
    close() {
      server = false;
      allowed = false;
      epoch++;
    },
  });
  function availability(value: boolean) {
    allowed = value;
    epoch++;
    peer.notify("availability", value && backend.available());
  }
  availability(true);
  async function action(
    method: "status" | "activate" | "unlock",
  ): Promise<DesktopSecretStorageStatus> {
    if (!server)
      return { ...lastStatus, available: false, error: "unavailable" };
    try {
      const result = desktopSecretStorageStatusSchema.parse(
        await peer.request(method, null, {
          timeoutMs: method === "activate" ? 120000 : 30000,
        }),
      );
      lastStatus = result;
      if (!allowed || !backend.available())
        return { ...result, available: false, error: "locked" };
      return result;
    } catch (error) {
      // Obtain the store's mode even after a failed migration; never report plaintext as a fallback.
      if (method !== "status") {
        try {
          return {
            ...desktopSecretStorageStatusSchema.parse(
              await peer.request("status", null),
            ),
            available: false,
            error: secretStorageCode(error),
          };
        } catch {
          /* The server disconnected. */
        }
      }
      return {
        ...lastStatus,
        available: false,
        error: secretStorageCode(error),
      };
    }
  }
  return { availability, action, close: () => peer.close() };
}
