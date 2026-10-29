import { Socket } from "node:net";
import { runPatcherApp } from "../launcher.js";
import { DesktopSecretRelay } from "../desktop-secret-relay.js";

// This entrypoint alone consumes the inherited desktop capability.
const relay = new DesktopSecretRelay(
  new Socket({ fd: 3, readable: true, writable: true }),
);
void runPatcherApp(process.argv.slice(2), relay)
  .catch(() => {
    process.stderr.write("Desktop-owned runtime failed to start.\n");
    process.exitCode = 1;
  })
  .finally(() => relay.close());
