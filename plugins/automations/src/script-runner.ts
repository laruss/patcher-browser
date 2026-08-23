import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { access, mkdir, stat } from "node:fs/promises";
import {
  AUTOMATION_SCRIPT_TIMEOUT_MAX_MS,
  type AutomationScriptInterpreter,
} from "./rpc-types.js";
import {
  resolveAutomationScriptPath,
  resolveDefaultInterpreter,
  resolveInterpreterCommand,
  scriptsRoot,
} from "./script-files.js";

const execFileAsync = promisify(execFile);
const SCRIPT_OUTPUT_MAX_BYTES = 1024 * 1024;

let resolvedPatcherPath: string | null = null;

/** Warning prepended to a script's output when Patcher could not be injected. */
export const PATCHER_NOT_INJECTED_WARNING =
  "[Patcher] warning: could not locate the Patcher CLI, so `patcher` is not on PATH for this script.";

async function commandWorks(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ordered places to look for the Patcher CLI, most authoritative first.
 *
 * Every candidate is an absolute path. The resolved value is handed to scripts
 * as `PATCHER_CLI`, which is documented as an absolute path, and a script is free to
 * rewrite `PATH` before it runs `"$PATCHER_CLI"` — a bare `patcher` would then resolve to
 * a different binary, or to none. Expanding `PATH` here rather than letting the
 * shell do it also keeps the probe and the script on the same executable.
 *
 * The env vars come before `PATH` because the server process does not reliably
 * inherit a `PATH` containing patcher: on a packaged install Patcher lives in the daemon
 * bundle directory, which is on no shell `PATH`. `PATCHER_CLI` (the binary) and
 * `PATCHER_CLI_DIR` (its directory) are the two documented pointers; see
 * packages/config/src/env-vars.ts. Relative values are skipped rather than
 * resolved against the process cwd, which has nothing to do with either.
 *
 * The trailing paths are macOS-only install locations, kept as a last resort.
 * Relying on them alone is what left Linux hosts unable to resolve Patcher at all.
 */
export function patcherBinaryCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = [];
  const pushIfAbsolute = (candidate: string): void => {
    if (isAbsolute(candidate)) {
      candidates.push(candidate);
    }
  };
  const fromCli = env.PATCHER_CLI?.trim();
  if (fromCli !== undefined && fromCli.length > 0) {
    pushIfAbsolute(fromCli);
  }
  const fromCliDir = env.PATCHER_CLI_DIR?.trim();
  if (fromCliDir !== undefined && fromCliDir.length > 0) {
    pushIfAbsolute(join(fromCliDir, "patcher"));
  }
  // Empty PATH entries mean "the current directory". Scripts run inside the
  // automation scripts directory, so honouring one would let a file named `patcher`
  // dropped next to a script stand in for the CLI.
  for (const entry of (env.PATH ?? "").split(delimiter)) {
    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      pushIfAbsolute(join(trimmed, "patcher"));
    }
  }
  candidates.push("/opt/homebrew/bin/patcher", "/usr/local/bin/patcher");
  return candidates;
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    const stats = await stat(candidate);
    if (!stats.isFile()) return false;
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate the Patcher CLI so it can be put on a script's PATH. Returns null rather
 * than throwing: injection is a convenience for scripts that call `patcher`, not a
 * precondition for running one. Failing the whole automation here meant a
 * script that never mentions Patcher still died before its first line.
 *
 * Candidates are stat-ed before being executed. Expanding `PATH` makes the list
 * long, and spawning a process per entry — each with its own timeout — would
 * make a host without Patcher pay seconds on every run.
 */
export async function resolvePatcherBinary(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (resolvedPatcherPath !== null) return resolvedPatcherPath;
  for (const candidate of patcherBinaryCandidates(env)) {
    if (!(await isExecutableFile(candidate))) continue;
    if (await commandWorks(candidate, ["--version"])) {
      resolvedPatcherPath = candidate;
      return candidate;
    }
  }
  return null;
}

/**
 * PATH for a script run, with Patcher's directory prepended when it is known.
 *
 * The absolute-path guard is belt and braces: patcherBinaryCandidates only yields
 * absolute paths, so a relative one would mean dirname() could return ".",
 * putting the automation scripts directory ahead of the system PATH.
 */
export function scriptPathEnv(
  patcherPath: string | null,
  inheritedPath: string | undefined,
): string {
  const basePath = inheritedPath ?? "";
  if (patcherPath === null || !isAbsolute(patcherPath)) {
    return basePath;
  }
  const patcherDir = dirname(patcherPath);
  return basePath.length > 0
    ? `${patcherDir}${delimiter}${basePath}`
    : patcherDir;
}

export function isWakeAgentSuppressed(output: string): boolean {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const last = lines[lines.length - 1];
  if (last === undefined) return false;
  try {
    const parsed: unknown = JSON.parse(last);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "wakeAgent" in parsed &&
      (parsed as { wakeAgent: unknown }).wakeAgent === false
    );
  } catch {
    return false;
  }
}

export interface ScriptRunResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
}

export interface ScriptRunOutcome {
  status: "succeeded" | "failed" | "skipped";
  output: string | null;
  exitCode: number | null;
  error: string | null;
  skipReason: string | null;
}

export function mapScriptResultToRun(
  result: ScriptRunResult,
): ScriptRunOutcome {
  if (result.timedOut) {
    return {
      status: "failed",
      output: result.output.length > 0 ? result.output : null,
      exitCode: null,
      error: "Script timed out",
      skipReason: null,
    };
  }
  if (result.exitCode !== 0) {
    return {
      status: "failed",
      output: result.output.length > 0 ? result.output : null,
      exitCode: result.exitCode,
      error: `Script exited with code ${result.exitCode}`,
      skipReason: null,
    };
  }
  if (result.output.trim().length === 0) {
    return {
      status: "skipped",
      output: null,
      exitCode: 0,
      error: null,
      skipReason: "empty output",
    };
  }
  if (isWakeAgentSuppressed(result.output)) {
    return {
      status: "skipped",
      output: null,
      exitCode: 0,
      error: null,
      skipReason: "wakeAgent false",
    };
  }
  return {
    status: "succeeded",
    output: result.output,
    exitCode: 0,
    error: null,
    skipReason: null,
  };
}

function trimOutput(output: string): string {
  if (Buffer.byteLength(output, "utf8") <= SCRIPT_OUTPUT_MAX_BYTES) {
    return output;
  }
  return `${output.slice(0, SCRIPT_OUTPUT_MAX_BYTES)}\n[output truncated]\n`;
}

function combinedOutput(
  stdout: string | Buffer,
  stderr: string | Buffer,
): string {
  return trimOutput(`${String(stdout)}${String(stderr)}`);
}

interface ExecFileError extends Error {
  code?: number | string;
  signal?: NodeJS.Signals;
  killed?: boolean;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

function exitCodeFromError(error: ExecFileError): number | null {
  return typeof error.code === "number" ? error.code : null;
}

export async function executeStoredScript(args: {
  pluginDataDir: string;
  automationId: string;
  runId: string;
  projectId: string;
  scriptFile: string;
  interpreter?: AutomationScriptInterpreter;
  timeoutMs: number;
  env?: Record<string, string>;
  serverUrl: string;
}): Promise<ScriptRunResult> {
  const scriptPath = await resolveAutomationScriptPath({
    dataDir: args.pluginDataDir,
    automationId: args.automationId,
    scriptFile: args.scriptFile,
  });
  const interpreter =
    args.interpreter ?? resolveDefaultInterpreter(args.scriptFile);
  const command = resolveInterpreterCommand(interpreter);
  const patcherPath = await resolvePatcherBinary();
  // A script that never calls Patcher must still run, so an unresolved CLI only
  // costs the PATH injection and leaves a note in the captured output.
  const warning =
    patcherPath === null ? `${PATCHER_NOT_INJECTED_WARNING}\n` : "";
  const scriptEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(args.env ?? {}),
    PATH: scriptPathEnv(patcherPath, process.env.PATH),
    PATCHER_SERVER_URL: args.serverUrl,
    PATCHER_PROJECT_ID: args.projectId,
    PATCHER_AUTOMATION_ID: args.automationId,
    PATCHER_AUTOMATION_RUN_ID: args.runId,
  };
  // Scripts are told where Patcher is the same way agent shells are, so `"$PATCHER_CLI"`
  // works even when the directory is already on PATH.
  if (patcherPath !== null) {
    scriptEnv.PATCHER_CLI = patcherPath;
  }
  const cwd = scriptsRoot(args.pluginDataDir);
  await mkdir(cwd, { recursive: true });
  try {
    const result = await execFileAsync(command, [scriptPath], {
      cwd,
      timeout: Math.min(args.timeoutMs, AUTOMATION_SCRIPT_TIMEOUT_MAX_MS),
      maxBuffer: SCRIPT_OUTPUT_MAX_BYTES,
      env: scriptEnv,
    });
    return {
      exitCode: 0,
      output: `${warning}${combinedOutput(result.stdout, result.stderr)}`,
      timedOut: false,
    };
  } catch (error) {
    const err = error as ExecFileError;
    return {
      exitCode: exitCodeFromError(err),
      output: `${warning}${combinedOutput(err.stdout ?? "", err.stderr ?? "")}`,
      timedOut: err.killed === true && err.signal === "SIGTERM",
    };
  }
}
