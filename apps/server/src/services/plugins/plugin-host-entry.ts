/**
 * The process plugins run in.
 *
 * One process per plugin, which is the supervisor's default and the reason it
 * is — see ./plugin-supervisor.ts. It still hosts as many channels as it is
 * given, each multiplexed over the one pipe: a reload swap puts a plugin's two
 * instances in here together, and `SHARED_PLACEMENT` puts several plugins in.
 *
 * Everything interesting is in ./plugin-child-runtime.ts, which is testable
 * over a linked port pair. This file is only the part that cannot be: turning
 * the process's own IPC channel into ports, and staying alive.
 */

import { createPluginChildRuntime } from "./plugin-child-runtime.js";
import { createPortMultiplexer } from "./plugin-port-multiplexer.js";
import { createParentProcessPort } from "./plugin-ports.js";

const problem = (text: string): void => {
  // Before a channel exists there is nowhere to report; after it does, the
  // host reads this process's stderr, which makes it the one place that works
  // at every moment of the process's life.
  process.stderr.write(`[plugin-host] ${text}\n`);
};

createPortMultiplexer({
  port: createParentProcessPort(),
  onUnroutable: problem,
  // The server opens channels; this side follows. A plugin process inventing
  // one would be a plugin claiming an identity nobody gave it.
  acceptUnknownKeys: true,
  onChannelOpened: (pluginId, port) => {
    createPluginChildRuntime({
      port,
      onProtocolError: (text) => problem(`${pluginId}: ${text}`),
    });
  },
});

// A plugin's unhandled rejection must not take the process down silently — it
// would take every channel in the process with it, and the host would see a
// pipe close with no reason, which is the least useful possible report.
process.on("unhandledRejection", (reason) => {
  problem(
    `unhandled rejection: ${
      reason instanceof Error
        ? (reason.stack ?? reason.message)
        : String(reason)
    }`,
  );
});
