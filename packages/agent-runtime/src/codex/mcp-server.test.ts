import { describe, expect, it } from "vitest";
import { buildCodexPatcherMcpServerConfig } from "./mcp-server.js";

/**
 * The CLI offered to a Codex turn as an MCP tool.
 *
 * What matters here is the credential and the shape: Codex hands an MCP server
 * a curated environment (measured: ten variables, none of them `PATCHER_*`), so
 * anything the CLI needs to identify itself has to be named in `env` — and
 * nothing else should be.
 */

const ENV_VARS = {
  PATCHER_CLI: "/opt/patcher/bin/patcher",
  PATCHER_SERVER_URL: "http://127.0.0.1:38986",
  PATCHER_THREAD_ID: "thr_1",
  PATCHER_THREAD_KEY: "derived-thread-key",
  PATCHER_PROJECT_ID: "proj_1",
  PATCHER_ENVIRONMENT_ID: "env_1",
  PATH: "/usr/bin",
};

describe("buildCodexPatcherMcpServerConfig", () => {
  it("spawns the CLI's own subcommand, with what the CLI needs to identify itself", () => {
    expect(buildCodexPatcherMcpServerConfig(ENV_VARS)).toEqual({
      mcp_servers: {
        patcher: {
          command: "/opt/patcher/bin/patcher",
          args: ["mcp-serve"],
          env: {
            PATCHER_SERVER_URL: "http://127.0.0.1:38986",
            PATCHER_THREAD_ID: "thr_1",
            PATCHER_THREAD_KEY: "derived-thread-key",
            PATCHER_PROJECT_ID: "proj_1",
            PATCHER_ENVIRONMENT_ID: "env_1",
          },
        },
      },
    });
  });

  it("passes no app key, even when one is somehow in the turn's environment", () => {
    // `buildThreadShellEnvironment` trades it away before a turn sees it, so
    // this is the second lock on the same door: the process that runs the CLI is
    // not sandboxed, so a CLI there that spoke for the app rather than for the
    // thread would be an escalation.
    const config = buildCodexPatcherMcpServerConfig({
      ...ENV_VARS,
      PATCHER_APP_KEY: "the-app-key",
    });

    const env = config?.mcp_servers.patcher?.env ?? {};
    expect(Object.keys(env)).not.toContain("PATCHER_APP_KEY");
    expect(Object.values(env)).not.toContain("the-app-key");
  });

  it("offers nothing without a thread key", () => {
    // A tool that reaches the API as an unidentified caller is worse than no
    // tool: the model would keep trying it and keep being refused.
    const { PATCHER_THREAD_KEY: _key, ...withoutKey } = ENV_VARS;

    expect(buildCodexPatcherMcpServerConfig(withoutKey)).toBeUndefined();
  });

  it("offers nothing without a CLI to spawn", () => {
    const { PATCHER_CLI: _cli, ...withoutCli } = ENV_VARS;

    expect(buildCodexPatcherMcpServerConfig(withoutCli)).toBeUndefined();
    expect(
      buildCodexPatcherMcpServerConfig({ ...ENV_VARS, PATCHER_CLI: "" }),
    ).toBeUndefined();
    expect(buildCodexPatcherMcpServerConfig(undefined)).toBeUndefined();
  });

  it("leaves out context the turn does not have", () => {
    const config = buildCodexPatcherMcpServerConfig({
      PATCHER_CLI: "/opt/patcher/bin/patcher",
      PATCHER_THREAD_ID: "thr_1",
      PATCHER_THREAD_KEY: "derived-thread-key",
      PATCHER_SERVER_URL: "http://127.0.0.1:38986",
    });

    expect(config?.mcp_servers.patcher?.env).toEqual({
      PATCHER_SERVER_URL: "http://127.0.0.1:38986",
      PATCHER_THREAD_ID: "thr_1",
      PATCHER_THREAD_KEY: "derived-thread-key",
    });
  });
});
