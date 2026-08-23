/**
 * A minimal plugin-side process, used by plugin-channel.test.ts to prove the
 * channel works across a real process boundary and not only across a linked
 * pair in one heap.
 *
 * It runs the same two pieces the real plugin host will:
 * `createParentProcessPort` and `createPluginChannel`.
 */
import type { JsonValue } from "@patcher/domain";
import { createPluginChannel } from "../../../../src/services/plugins/plugin-channel.js";
import { createParentProcessPort } from "../../../../src/services/plugins/plugin-ports.js";

const channel = createPluginChannel({
  port: createParentProcessPort(),
  name: "plugin:echo",
  async onRequest({ method, target, payload, signal }): Promise<JsonValue> {
    switch (method) {
      case "echo":
        return { method, target: target ?? null, payload };
      case "throw":
        throw Object.assign(new Error("configure me first"), {
          name: "NeedsConfigurationError",
        });
      case "hang":
        // Settles only when the caller cancels, which is how a cancel message
        // is observed from the far side of a real pipe.
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            resolve();
          });
        });
        return { cancelled: true, reason: String(signal.reason) };
      case "exit": {
        // Dies mid-request, so the parent's in-flight call has to be rejected
        // by the channel rather than waiting forever.
        process.exit(7);
      }
      default:
        throw new Error(`unknown method ${method}`);
    }
  },
});

// Sent unprompted, which is the half of the channel a request/response test
// cannot reach: the child is a peer, not a server waiting to be asked.
channel.notify({ method: "ready", payload: { pid: process.pid } });
