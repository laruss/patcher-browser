import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCliExecution } from "../src/commands/run-cli.js";
import {
  expectedDevPorts,
  expectedDevServerUrl,
} from "./dev-instance-expectations.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..", "..", "..");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("run-cli", () => {
  it("runs the built CLI in development mode", () => {
    vi.stubEnv("NODE_ENV", "development");

    const execution = resolveCliExecution(["thread", "list"]);

    expect(execution.command).toBe(process.execPath);
    expect(execution.args).toEqual([
      "apps/cli/dist/index.js",
      "thread",
      "list",
    ]);
    expect(execution.env.PATCHER_SERVER_URL).toBe(
      expectedDevServerUrl(repoRoot),
    );
    expect(execution.env.PATCHER_HOST_DAEMON_PORT).toBe(
      String(expectedDevPorts(repoRoot).hostDaemonPort),
    );
  });

  it("runs the built CLI in production mode", () => {
    vi.stubEnv("NODE_ENV", "production");

    const execution = resolveCliExecution(["--help"]);

    expect(execution.command).toBe(process.execPath);
    expect(execution.args).toEqual(["apps/cli/dist/index.js", "--help"]);
    expect(execution.env.NODE_ENV).toBe("production");
  });

  it("lets explicit development CLI targets win", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PATCHER_SERVER_URL", "http://localhost:4444");
    vi.stubEnv("PATCHER_HOST_DAEMON_PORT", "5555");

    const execution = resolveCliExecution(["status"]);

    expect(execution.env.PATCHER_SERVER_URL).toBe("http://localhost:4444");
    expect(execution.env.PATCHER_HOST_DAEMON_PORT).toBe("5555");
  });
});
