#!/usr/bin/env node
import { runPatcherHostDaemon } from "../launcher.js";

void runPatcherHostDaemon().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
