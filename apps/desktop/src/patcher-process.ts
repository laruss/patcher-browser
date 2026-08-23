import { spawn, type ChildProcess } from "node:child_process";

export interface RuntimeLogBuffer {
  append(chunk: Buffer | string): void;
  text(): string;
}

export interface CreateRuntimeLogBufferArgs {
  maxLines: number;
}

export interface StartPatcherAppProcessArgs {
  bridgePath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  logLineLimit: number;
  runtime: PatcherAppProcessRuntime;
}

export interface PatcherAppProcess {
  childProcess: ChildProcess;
  exit: Promise<PatcherAppProcessExit>;
  logs: RuntimeLogBuffer;
  pid: number;
  stop(args: StopPatcherAppProcessArgs): Promise<void>;
}

export interface PatcherAppProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface StopPatcherAppProcessArgs {
  killSignal: NodeJS.Signals;
  killTimeoutMs: number;
  signal: NodeJS.Signals;
  timeoutMs: number;
}

export interface CreateElectronNodeEnvArgs {
  env: NodeJS.ProcessEnv;
}

export type PatcherAppProcessRuntimeMode = "electron-node" | "node";

export interface PatcherAppProcessRuntime {
  executablePath: string;
  mode: PatcherAppProcessRuntimeMode;
}

export interface CreatePatcherAppProcessEnvArgs {
  env: NodeJS.ProcessEnv;
  runtimeMode: PatcherAppProcessRuntimeMode;
}

export interface ResolvePatcherAppProcessRuntimeArgs {
  env: NodeJS.ProcessEnv;
  isPackaged: boolean;
  processExecPath: string;
}

interface WaitForProcessExitWithTimeoutArgs {
  childProcess: ChildProcess;
  timeoutMs: number;
}

type WaitForProcessExitWithTimeoutResult = "exited" | "timed-out";
type ResolveWaitForProcessExitWithTimeout = (
  result: WaitForProcessExitWithTimeoutResult,
) => void;

export function createRuntimeLogBuffer(
  args: CreateRuntimeLogBufferArgs,
): RuntimeLogBuffer {
  const lines: string[] = [];

  return {
    append(chunk) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      for (const line of text.split(/\r?\n/u)) {
        if (line.length === 0) {
          continue;
        }
        lines.push(line);
      }
      while (lines.length > args.maxLines) {
        lines.shift();
      }
    },
    text() {
      return lines.join("\n");
    },
  };
}

export function createElectronNodeEnv(
  args: CreateElectronNodeEnvArgs,
): NodeJS.ProcessEnv {
  return {
    ...args.env,
    ELECTRON_RUN_AS_NODE: "1",
  };
}

export function createPatcherAppProcessEnv(
  args: CreatePatcherAppProcessEnvArgs,
): NodeJS.ProcessEnv {
  if (args.runtimeMode === "electron-node") {
    return createElectronNodeEnv({ env: args.env });
  }

  const env = { ...args.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

export function resolvePatcherAppProcessRuntime(
  args: ResolvePatcherAppProcessRuntimeArgs,
): PatcherAppProcessRuntime {
  if (args.isPackaged) {
    return {
      executablePath: args.processExecPath,
      mode: "electron-node",
    };
  }

  const rawNodeExecPath = args.env.PATCHER_DESKTOP_NODE_EXEC_PATH?.trim();
  if (rawNodeExecPath === undefined || rawNodeExecPath.length === 0) {
    throw new Error(
      "PATCHER_DESKTOP_NODE_EXEC_PATH is required in desktop dev mode. Launch through apps/desktop/scripts/run-electron-dev.mjs.",
    );
  }

  return {
    executablePath: rawNodeExecPath,
    mode: "node",
  };
}

function hasProcessExited(childProcess: ChildProcess): boolean {
  return childProcess.exitCode !== null || childProcess.signalCode !== null;
}

function waitForProcessExit(
  childProcess: ChildProcess,
): Promise<PatcherAppProcessExit> {
  if (hasProcessExited(childProcess)) {
    return Promise.resolve({
      code: childProcess.exitCode,
      signal: childProcess.signalCode,
    });
  }

  return new Promise<PatcherAppProcessExit>((resolvePromise) => {
    childProcess.once("exit", (code, signal) => {
      resolvePromise({ code, signal });
    });
  });
}

function waitForProcessExitWithTimeout(
  args: WaitForProcessExitWithTimeoutArgs,
): Promise<WaitForProcessExitWithTimeoutResult> {
  if (hasProcessExited(args.childProcess)) {
    return Promise.resolve("exited");
  }

  return new Promise<WaitForProcessExitWithTimeoutResult>((resolvePromise) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish: ResolveWaitForProcessExitWithTimeout = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      args.childProcess.off("exit", exitHandler);
      resolvePromise(result);
    };
    const exitHandler = (): void => {
      finish("exited");
    };
    timeout = setTimeout(() => {
      finish("timed-out");
    }, args.timeoutMs);
    timeout.unref();

    args.childProcess.once("exit", exitHandler);
    if (hasProcessExited(args.childProcess)) {
      finish("exited");
    }
  });
}

export function startPatcherAppProcess(
  args: StartPatcherAppProcessArgs,
): PatcherAppProcess {
  const logs = createRuntimeLogBuffer({ maxLines: args.logLineLimit });
  const childProcess = spawn(args.runtime.executablePath, [args.bridgePath], {
    cwd: args.cwd,
    env: createPatcherAppProcessEnv({
      env: args.env,
      runtimeMode: args.runtime.mode,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pid = childProcess.pid;
  if (pid === undefined) {
    throw new Error("patcher-app child process did not expose a PID");
  }

  if (childProcess.stdout !== null) {
    childProcess.stdout.on("data", (chunk: Buffer) => {
      logs.append(chunk);
    });
  }

  if (childProcess.stderr !== null) {
    childProcess.stderr.on("data", (chunk: Buffer) => {
      logs.append(chunk);
    });
  }

  const exit = waitForProcessExit(childProcess);

  return {
    childProcess,
    exit,
    logs,
    pid,
    async stop(stopArgs) {
      if (hasProcessExited(childProcess)) {
        return;
      }
      childProcess.kill(stopArgs.signal);
      const gracefulResult = await waitForProcessExitWithTimeout({
        childProcess,
        timeoutMs: stopArgs.timeoutMs,
      });
      if (gracefulResult === "exited") {
        return;
      }

      if (!hasProcessExited(childProcess)) {
        childProcess.kill(stopArgs.killSignal);
      }
      await waitForProcessExitWithTimeout({
        childProcess,
        timeoutMs: stopArgs.killTimeoutMs,
      });
    },
  };
}
