#!/usr/bin/env node
import { runPatcherApp } from "../launcher.js";

void runPatcherApp().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
