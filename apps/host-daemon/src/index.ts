import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadHostDaemonStartConfig } from "@patcher/config/host-daemon";
import { loadHostDaemonEntrypointConfig } from "@patcher/config/host-daemon-entrypoint";
import {
  installSafeProcessDiagnostics,
  writeSafeProcessDiagnosticReport,
} from "@patcher/process-utils";

interface ReportStartupFailureArgs {
  diagnosticsLogsDir: string;
  error: unknown;
}

type MainFailureHandler = (error: unknown) => void;

const entrypointDir = dirname(fileURLToPath(import.meta.url));

function resolveEntrypointBridgeBundleDir(): string | undefined {
  return existsSync(join(entrypointDir, "patcher-claude-code-bridge.mjs"))
    ? entrypointDir
    : undefined;
}

function resolveDiagnosticsLogsDir(): string {
  const hostDaemonStartConfig = loadHostDaemonStartConfig({
    enableLocalApi: true,
  });

  if (hostDaemonStartConfig.dataDir === undefined) {
    throw new Error("Host daemon data directory is required");
  }

  return join(hostDaemonStartConfig.dataDir, "logs");
}

function reportStartupFailure(args: ReportStartupFailureArgs): void {
  try {
    writeSafeProcessDiagnosticReport({
      kind: "startupFailure",
      logsDir: args.diagnosticsLogsDir,
      processName: "host-daemon",
      error: args.error,
    });
  } catch {
    // Keep the original startup failure visible even if diagnostic logging fails.
  }

  const message =
    args.error instanceof Error
      ? (args.error.stack ?? args.error.message)
      : String(args.error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function runHostDaemonEntrypoint(): Promise<void> {
  const hostDaemonEntrypointConfig = loadHostDaemonEntrypointConfig();
  // Keep this import after diagnostics so ESM evaluation failures are reported.
  const hostDaemonModule = await import("./start-host-daemon.js");
  const daemon = await hostDaemonModule.startHostDaemon({
    patcherExecutableDirectory: hostDaemonEntrypointConfig.PATCHER_CLI_DIR,
    bridgeBundleDir:
      hostDaemonEntrypointConfig.PATCHER_BRIDGE_DIR ??
      resolveEntrypointBridgeBundleDir(),
    autoUpdate: hostDaemonEntrypointConfig.PATCHER_HOST_DAEMON_AUTO_UPDATE,
    enrollKey: hostDaemonEntrypointConfig.PATCHER_HOST_ENROLL_KEY,
    hostId: hostDaemonEntrypointConfig.PATCHER_HOST_ID,
    hostName: hostDaemonEntrypointConfig.PATCHER_HOST_NAME,
    hostType: hostDaemonEntrypointConfig.PATCHER_HOST_TYPE,
  });
  await daemon.waitUntilStopped();
}

const entrypointPath = process.argv[1];
const isMainModule =
  typeof entrypointPath === "string" &&
  fileURLToPath(import.meta.url) === entrypointPath;

if (isMainModule) {
  const diagnosticsLogsDir = resolveDiagnosticsLogsDir();
  installSafeProcessDiagnostics({
    logsDir: diagnosticsLogsDir,
    processName: "host-daemon",
  });
  const handleMainFailure: MainFailureHandler = (error) => {
    reportStartupFailure({ diagnosticsLogsDir, error });
  };
  void runHostDaemonEntrypoint().catch(handleMainFailure);
}
