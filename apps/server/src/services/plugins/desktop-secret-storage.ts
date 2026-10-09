import type { Duplex } from "node:stream";
import {
  PluginSecretStore,
  PrivateSecretChannel,
  SecretStorageError,
  secretStorageCode,
  type KeyEnvelope,
} from "@patcher/secret-storage";

export function createDesktopSecretStorage(dataDir: string, stream?: Duplex) {
  let store: PluginSecretStore;
  let retry: (() => Promise<void>) | undefined;
  const channel =
    stream === undefined
      ? undefined
      : new PrivateSecretChannel(stream, {
          request: async (method, payload, signal) => {
            if (payload !== null)
              throw new SecretStorageError("invalid_request");
            if (method === "status") return store.status();
            if (method === "activate") {
              const result = await store.activate(signal);
              await retry?.();
              return result;
            }
            if (method === "unlock") {
              store.unlock();
              await store.initialize();
              await retry?.();
              return store.status();
            }
            throw new SecretStorageError("invalid_request");
          },
          notice: (name, value) => {
            if (name !== "availability") return;
            if (!value) store.lock("locked");
            else {
              store.unlock();
              void store
                .initialize()
                .then(() => retry?.())
                .catch((error: unknown) => {
                  if (secretStorageCode(error) !== "cancelled")
                    store.lock(secretStorageCode(error));
                });
            }
          },
          close: () => store.lock("unavailable"),
        });
  async function request(
    method: "wrap" | "unwrap",
    payload: unknown,
  ): Promise<unknown> {
    if (channel === undefined) throw new SecretStorageError("unavailable");
    try {
      return await channel.request(method, payload);
    } catch (error) {
      if (secretStorageCode(error) !== "cancelled")
        store.lock(secretStorageCode(error));
      throw error;
    }
  }
  store = new PluginSecretStore({
    dataDir,
    ...(channel === undefined
      ? {}
      : {
          broker: {
            async wrap(storeId: string, key: Buffer): Promise<string> {
              const result = await request("wrap", {
                storeId,
                key: key.toString("base64"),
              });
              if (typeof result !== "string" || result.length > 12_000)
                throw new SecretStorageError("corrupt");
              return result;
            },
            async unwrap(envelope: KeyEnvelope): Promise<Buffer> {
              const result = await request("unwrap", envelope);
              if (
                typeof result !== "string" ||
                !/^[A-Za-z0-9+/]{43}=$/.test(result)
              )
                throw new SecretStorageError("corrupt");
              return Buffer.from(result, "base64");
            },
          },
        }),
  });
  return {
    store,
    setRetry: (callback: () => Promise<void>) => {
      retry = callback;
    },
    close: () => {
      store.lock("unavailable");
      channel?.close();
    },
  };
}
