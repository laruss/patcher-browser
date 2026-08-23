import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPatcherAppProcessEnv,
  resolvePatcherAppProcessRuntime,
  startPatcherAppProcess,
  type PatcherAppProcess,
} from "../src/patcher-process.js";

interface TempScript {
  path: string;
  root: string;
}

interface WaitForLogArgs {
  process: PatcherAppProcess;
  text: string;
  timeoutMs: number;
}

interface CreateTempScriptArgs {
  contents: string;
}

const tempScripts: TempScript[] = [];
const processes: PatcherAppProcess[] = [];

async function createTempScript(
  args: CreateTempScriptArgs,
): Promise<TempScript> {
  const root = await mkdtemp(join(tmpdir(), "patcher-desktop-process-"));
  const path = join(root, "child.mjs");
  await writeFile(path, args.contents, "utf8");
  const script = { path, root };
  tempScripts.push(script);
  return script;
}

async function waitForLog(args: WaitForLogArgs): Promise<void> {
  const deadline = Date.now() + args.timeoutMs;
  while (Date.now() <= deadline) {
    if (args.process.logs.text().includes(args.text)) {
      return;
    }
    await new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, 10);
    });
  }
  throw new Error(`Timed out waiting for log line: ${args.text}`);
}

afterEach(async () => {
  for (const processEntry of processes.splice(0)) {
    if (
      processEntry.childProcess.exitCode === null &&
      processEntry.childProcess.signalCode === null
    ) {
      processEntry.childProcess.kill("SIGKILL");
      await processEntry.exit;
    }
  }

  while (tempScripts.length > 0) {
    const script = tempScripts.pop();
    if (script !== undefined) {
      await rm(script.root, { force: true, recursive: true });
    }
  }
});

describe("Patcher app process", () => {
  it("uses the dev Node executable without Electron node mode", () => {
    const env = createPatcherAppProcessEnv({
      env: {
        ELECTRON_RUN_AS_NODE: "1",
      },
      runtimeMode: "node",
    });

    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("uses Electron node mode for packaged runtimes", () => {
    const runtime = resolvePatcherAppProcessRuntime({
      env: {},
      isPackaged: true,
      processExecPath: "/Applications/Patcher.app/Contents/MacOS/patcher",
    });

    expect(runtime).toEqual({
      executablePath: "/Applications/Patcher.app/Contents/MacOS/patcher",
      mode: "electron-node",
    });
    expect(
      createPatcherAppProcessEnv({
        env: {},
        runtimeMode: runtime.mode,
      }).ELECTRON_RUN_AS_NODE,
    ).toBe("1");
  });

  it("requires the host Node executable in desktop dev mode", () => {
    expect(() =>
      resolvePatcherAppProcessRuntime({
        env: {},
        isPackaged: false,
        processExecPath: "/path/to/electron",
      }),
    ).toThrow("PATCHER_DESKTOP_NODE_EXEC_PATH is required");

    expect(
      resolvePatcherAppProcessRuntime({
        env: {
          PATCHER_DESKTOP_NODE_EXEC_PATH: "/usr/local/bin/node",
        },
        isPackaged: false,
        processExecPath: "/path/to/electron",
      }),
    ).toEqual({
      executablePath: "/usr/local/bin/node",
      mode: "node",
    });
  });

  it("escalates to SIGKILL when the bridge ignores SIGTERM", async () => {
    const script = await createTempScript({
      contents: `
process.on("SIGTERM", () => {
  process.stdout.write("ignored SIGTERM\\n");
});
process.stdout.write("ready\\n");
setInterval(() => undefined, 1000);
`,
    });
    const processEntry = startPatcherAppProcess({
      bridgePath: script.path,
      cwd: script.root,
      env: process.env,
      logLineLimit: 20,
      runtime: {
        executablePath: process.execPath,
        mode: "node",
      },
    });
    processes.push(processEntry);
    await waitForLog({
      process: processEntry,
      text: "ready",
      timeoutMs: 1_000,
    });

    await processEntry.stop({
      killSignal: "SIGKILL",
      killTimeoutMs: 1_000,
      signal: "SIGTERM",
      timeoutMs: 50,
    });

    const exit = await processEntry.exit;
    expect(processEntry.logs.text()).toContain("ignored SIGTERM");
    expect(exit.signal).toBe("SIGKILL");
  });
});
