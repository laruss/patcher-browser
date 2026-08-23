#!/usr/bin/env node
import { runPatcherCli } from "../launcher.js";

void runPatcherCli().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
