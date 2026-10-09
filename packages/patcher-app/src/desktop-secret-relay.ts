import type { Duplex } from "node:stream";
import {
  PrivateSecretChannel,
  SecretStorageError,
} from "@patcher/secret-storage";

/** Each server restart gets a fresh channel; pending/late replies cannot cross it. */
export class DesktopSecretRelay {
  private readonly parent: PrivateSecretChannel;
  private server: PrivateSecretChannel | undefined;
  private available = false;
  private closed = false;

  constructor(stream: Duplex) {
    this.parent = new PrivateSecretChannel(stream, {
      request: async (method, payload, signal) => {
        const server = this.server;
        if (server === undefined) throw new SecretStorageError("unavailable");
        return server.request(method, payload, {
          signal,
          timeoutMs:
            method === "activate" || method.startsWith("credential.")
              ? 120_000
              : 30_000,
        });
      },
      notice: (name, value) => {
        if (name === "availability") {
          this.available = value;
          this.server?.notify(name, value);
        }
      },
      close: () => {
        this.closed = true;
        this.server?.close();
      },
    });
  }
  attach(stream: Duplex): void {
    this.server?.close();
    if (this.closed) {
      stream.destroy();
      return;
    }
    const server = new PrivateSecretChannel(stream, {
      request: (method, payload, signal) =>
        this.parent.request(method, payload, {
          signal,
          timeoutMs: method.startsWith("credential.") ? 120_000 : 30_000,
        }),
      close: () => {
        if (this.server === server) {
          this.server = undefined;
          this.parent.notify("server", false);
        }
      },
    });
    this.server = server;
    server.notify("availability", this.available);
    this.parent.notify("server", true);
  }
  close(): void {
    this.parent.close();
  }
}
