import { join } from "node:path";
import type { Duplex } from "node:stream";
import { loadServerConfig } from "@patcher/config/server";
import {
  installSafeProcessDiagnostics,
  writeSafeProcessDiagnosticReport,
} from "@patcher/process-utils";

export function startServerEntry(secretStream?: Duplex): void {
  const serverConfig = loadServerConfig();
  const diagnosticsLogsDir = join(serverConfig.PATCHER_DATA_DIR, "logs");
  installSafeProcessDiagnostics({
    logsDir: diagnosticsLogsDir,
    processName: "server",
  });
  function reportStartupFailure(error: unknown): void {
    try {
      writeSafeProcessDiagnosticReport({
        kind: "startupFailure",
        logsDir: diagnosticsLogsDir,
        processName: "server",
        error,
      });
    } catch {
      /* Keep the original failure visible if diagnostics cannot be saved. */
    }
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
  async function main(): Promise<void> {
    // Keep this import after diagnostics so ESM evaluation failures are reported.
    const serverModule = await import("./start-server.js");
    await serverModule.runServer(serverConfig, secretStream);
  }
  void main().catch(reportStartupFailure);
}
