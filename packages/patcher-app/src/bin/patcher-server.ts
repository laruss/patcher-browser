#!/usr/bin/env node
import { runPatcherServer } from "../launcher.js";

void runPatcherServer().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
