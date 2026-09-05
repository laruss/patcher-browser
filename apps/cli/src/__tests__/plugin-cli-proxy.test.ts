import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

import { registerEnvironmentCommands } from "../commands/environment.js";
import { registerGuideCommand } from "../commands/guide.js";
import { registerManagerCommands } from "../commands/manager.js";
import { registerPluginCommands } from "../commands/plugin.js";
import { registerProjectCommands } from "../commands/project.js";
import { registerProviderCommands } from "../commands/provider.js";
import { registerSkillCommands } from "../commands/skill.js";
import { registerStatusCommand } from "../commands/status.js";
import { registerThemeCommands } from "../commands/theme.js";
import { registerThreadCommands } from "../commands/thread/index.js";
import {
  describeUnreachableServer,
  fetchPluginCliContributions,
  describeUnknownPluginCommand,
  findPluginCliCommand,
  listDisabledPlugins,
  pluginProxyCandidate,
  runPluginCliCommand,
  type PluginCliContributionEntry,
} from "../plugin-cli-proxy.js";

// Mirror of RESERVED_PATCHER_CLI_COMMANDS in
// apps/server/src/services/plugins/plugin-api.ts — the server rejects plugin
// CLI commands shadowing core Patcher commands. Update both together.
const RESERVED_PATCHER_CLI_COMMANDS = [
  "environment",
  "guide",
  "help",
  "manager",
  "plugin",
  "project",
  "provider",
  "skill",
  "status",
  "theme",
  "thread",
];

function buildProgram(): Command {
  const program = new Command();
  const getUrl = () => "http://localhost";
  registerStatusCommand(program, getUrl);
  registerProjectCommands(program, getUrl);
  registerProviderCommands(program, getUrl);
  registerManagerCommands(program, getUrl);
  registerThreadCommands(program, getUrl);
  registerEnvironmentCommands(program, getUrl);
  registerThemeCommands(program, getUrl);
  registerPluginCommands(program, getUrl);
  registerSkillCommands(program, getUrl, () => ({ serverUrl: getUrl() }));
  registerGuideCommand(program);
  return program;
}

function topLevelCommandNames(program: Command): string[] {
  return program.commands.flatMap((command) => [
    command.name(),
    ...command.aliases(),
  ]);
}

describe("reserved Patcher CLI command names", () => {
  it("every core top-level command is on the server's reserved list", () => {
    const names = topLevelCommandNames(buildProgram());
    const reserved = new Set(RESERVED_PATCHER_CLI_COMMANDS);
    for (const name of names) {
      expect(
        reserved,
        `"${name}" is missing from RESERVED_PATCHER_CLI_COMMANDS`,
      ).toContain(name);
    }
  });

  it("the reserved list carries no stale entries", () => {
    const names = new Set(topLevelCommandNames(buildProgram()));
    names.add("help"); // commander built-in
    for (const reserved of RESERVED_PATCHER_CLI_COMMANDS) {
      expect(
        names,
        `"${reserved}" is reserved but not a core command`,
      ).toContain(reserved);
    }
  });
});

describe("pluginProxyCandidate", () => {
  const known = new Set(["thread", "plugin", "help"]);

  it("returns unknown command names", () => {
    expect(pluginProxyCandidate("linear", known)).toBe("linear");
  });

  it("proxies the builtin plugin commands the kernel no longer owns", () => {
    // `automation` moved into a builtin plugin: it must not be reserved, and
    // the real program must not register it, so the proxy resolves it against
    // the running server. (`connect` was here too until its plugin was
    // removed with the cloud.)
    const names = new Set(topLevelCommandNames(buildProgram()));
    names.add("help");
    for (const moved of ["automation"]) {
      expect(RESERVED_PATCHER_CLI_COMMANDS).not.toContain(moved);
      expect(pluginProxyCandidate(moved, names)).toBe(moved);
    }
  });

  it("never proxies flags, empty args, or core commands", () => {
    expect(pluginProxyCandidate(undefined, known)).toBeNull();
    expect(pluginProxyCandidate("", known)).toBeNull();
    expect(pluginProxyCandidate("--version", known)).toBeNull();
    expect(pluginProxyCandidate("-h", known)).toBeNull();
    expect(pluginProxyCandidate("thread", known)).toBeNull();
    expect(pluginProxyCandidate("help", known)).toBeNull();
  });
});

describe("fetchPluginCliContributions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("distinguishes an unreachable server from an old/invalid one", async () => {
    // Unreachable (server down): fetch rejects → keep the thrown error so
    // the caller can diagnose refused vs blocked vs timed out.
    const thrown = new Error("ECONNREFUSED");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw thrown;
      }),
    );
    await expect(
      fetchPluginCliContributions("http://localhost"),
    ).resolves.toEqual({
      outcome: "unreachable",
      cause: thrown,
    });

    // Old server without the route: silent fallback to commander's error.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    await expect(
      fetchPluginCliContributions("http://localhost"),
    ).resolves.toEqual({
      outcome: "invalid",
    });
  });

  it("returns validated contribution entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              cliCommands: [
                {
                  pluginId: "connect",
                  name: "connect",
                  summary: "s",
                  commands: [],
                },
                { bogus: true },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await fetchPluginCliContributions("http://localhost");
    expect(result).toEqual({
      outcome: "ok",
      contributions: [
        { pluginId: "connect", name: "connect", summary: "s", commands: [] },
      ],
    });
  });
});

describe("describeUnreachableServer", () => {
  const url = "http://127.0.0.1:38986";

  function fetchFailed(code: string): Error {
    return new TypeError("fetch failed", {
      cause: Object.assign(new Error(`connect ${code} 127.0.0.1:38986`), {
        code,
      }),
    });
  }

  function aggregateFetchFailed(codes: string[]): Error {
    const errors = codes.map((code, index) =>
      Object.assign(new Error(`connect ${code} address-${index + 1}:38986`), {
        code,
      }),
    );
    return new TypeError("fetch failed", {
      // NodeAggregateError exposes the first attempt's code on the aggregate,
      // even when later attempts failed for a different reason.
      cause: Object.assign(new AggregateError(errors), {
        code: errors[0]?.code,
      }),
    });
  }

  it("says Patcher is not running only on ECONNREFUSED", () => {
    expect(describeUnreachableServer(url, fetchFailed("ECONNREFUSED"))).toBe(
      `Patcher is not running at ${url} — open the Patcher app, then re-run this command.`,
    );
  });

  it("requires every aggregate connection attempt to be refused", () => {
    expect(
      describeUnreachableServer(
        url,
        aggregateFetchFailed(["ECONNREFUSED", "ECONNREFUSED"]),
      ),
    ).toBe(
      `Patcher is not running at ${url} — open the Patcher app, then re-run this command.`,
    );

    const mixedMessage = describeUnreachableServer(
      url,
      aggregateFetchFailed(["ECONNREFUSED", "EPERM"]),
    );
    expect(mixedMessage).toContain(`Cannot reach Patcher at ${url}: EPERM`);
    expect(mixedMessage).toContain("Patcher may still be running");
    expect(mixedMessage).not.toContain("not running at");
  });

  it("reports a blocked connection without declaring Patcher down", () => {
    for (const code of ["EPERM", "EACCES"]) {
      const message = describeUnreachableServer(url, fetchFailed(code));
      expect(message).toContain(`Cannot reach Patcher at ${url}: ${code}`);
      expect(message).toContain("Patcher may still be running");
      expect(message).not.toContain("not running at");
    }
  });

  it("reports a timeout with the probe window", () => {
    const timeout = Object.assign(new Error("The operation timed out"), {
      name: "TimeoutError",
    });
    expect(describeUnreachableServer(url, timeout, 2000)).toBe(
      `Patcher did not respond at ${url} within 2000ms — it may be busy or unreachable.`,
    );
  });

  it("falls back to the unwrapped cause chain", () => {
    const err = new TypeError("fetch failed", {
      cause: new Error("getaddrinfo ENOTFOUND example.invalid"),
    });
    expect(describeUnreachableServer(url, err)).toBe(
      `Cannot reach Patcher at ${url}: fetch failed: getaddrinfo ENOTFOUND example.invalid`,
    );
  });
});

describe("an unknown `patcher <command>`", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubPlugins(plugins: unknown[]): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ plugins }), { status: 200 }),
      ),
    );
  }

  it("lists the plugins that are off", async () => {
    stubPlugins([
      { id: "automations", enabled: true },
      { id: "connect", enabled: false },
    ]);
    await expect(listDisabledPlugins("http://localhost")).resolves.toEqual([
      { id: "connect", enabled: false, status: null, statusDetail: null },
    ]);
  });

  it("counts one that failed to load as off", async () => {
    stubPlugins([
      {
        id: "automations",
        enabled: true,
        status: "disabled",
        statusDetail: "plugin failed to load",
      },
    ]);
    await expect(listDisabledPlugins("http://localhost")).resolves.toEqual([
      {
        id: "automations",
        enabled: true,
        status: "disabled",
        statusDetail: "plugin failed to load",
      },
    ]);
  });

  it("answers with an empty list on any fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await expect(listDisabledPlugins("http://localhost")).resolves.toEqual([]);
  });

  it("names the plugin, and owns the answer, when the command is its id", () => {
    const advice = describeUnknownPluginCommand("connect", [
      { id: "connect", enabled: false, status: null, statusDetail: null },
    ]);
    // `resolved`: nothing is being guessed, so commander's "unknown command"
    // must not follow it and contradict it.
    expect(advice?.kind).toBe("resolved");
    expect(advice?.message).toContain("patcher plugin enable connect");
  });

  it("hints, without taking the error over, when the command is not an id", () => {
    // The case this exists for, measured on 2026-09-05: `browser-tools`
    // provides `patcher browser`, so matching on the id alone left the most
    // likely first command an outside agent runs answering "unknown command",
    // which reads as "no such feature" rather than "it is switched off".
    const advice = describeUnknownPluginCommand("browser", [
      { id: "browser-tools", enabled: false, status: null, statusDetail: null },
    ]);
    expect(advice?.kind).toBe("hint");
    expect(advice?.message).toContain("browser-tools");
    expect(advice?.message).toContain("patcher plugin enable <id>");
  });

  it("leaves a typo to commander even while a plugin is off", () => {
    // The regression the first version shipped: `browser-tools` is disabled by
    // default, so *every* mistyped command on *every* machine took the plugin
    // branch and lost commander's "unknown command 'statsu'. Did you mean
    // status?". A hint is additive; only a named plugin replaces the error.
    const advice = describeUnknownPluginCommand("statsu", [
      { id: "browser-tools", enabled: false, status: null, statusDetail: null },
    ]);
    expect(advice?.kind).toBe("hint");
    // Phrased as a possibility rather than a verdict, since it is one.
    expect(advice?.message).toContain("If `statsu` is one of theirs");
    expect(advice?.message).not.toContain("is provided by");
  });

  it("says nothing when every plugin is running", () => {
    // Then it really is an unknown command, and commander's own message is the
    // right one — inventing a plugin explanation would send the reader looking
    // for something that does not exist.
    expect(describeUnknownPluginCommand("levitate", [])).toBeNull();
  });

  it("does not list every plugin on a machine that has many off", () => {
    const disabled = Array.from({ length: 12 }, (_, index) => ({
      id: `plugin-${index}`,
      enabled: false,
      status: null,
      statusDetail: null,
    }));
    const advice = describeUnknownPluginCommand("browser", disabled);
    expect(advice?.message).toContain("plugin-5");
    expect(advice?.message).not.toContain("plugin-6");
    expect(advice?.message).toContain("and 6 more");
  });
});

describe("findPluginCliCommand", () => {
  const contributions: PluginCliContributionEntry[] = [
    { pluginId: "linear", name: "linear", summary: "Linear", commands: [] },
    { pluginId: "acme", name: "acme-tools", summary: "Acme", commands: [] },
  ];

  it("matches on the registered command name, not the plugin id", () => {
    expect(findPluginCliCommand(contributions, "acme-tools")?.pluginId).toBe(
      "acme",
    );
    expect(findPluginCliCommand(contributions, "acme")).toBeUndefined();
    expect(findPluginCliCommand(contributions, "linear")?.pluginId).toBe(
      "linear",
    );
  });
});

describe("fetchPluginCliContributions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tells a refusal apart from a malformed answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ code: "unauthorized", message: "Unauthorized" }),
            { status: 401, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const result = await fetchPluginCliContributions("http://localhost");

    // "invalid" falls through to commander, which then calls a plugin command
    // that exists an unknown command — advice about the wrong problem.
    expect(result.outcome).toBe("unauthorized");
  });
});

describe("runPluginCliCommand", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says what a 401 is about instead of calling it unexpected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 })),
    );
    const written: string[] = [];
    const sink = {
      write(value: string, callback: (error?: Error | null) => void) {
        written.push(value);
        callback();
        return true;
      },
    };

    const exitCode = await runPluginCliCommand(
      "http://localhost",
      "browser-tools",
      ["status"],
      { stdout: sink, stderr: sink },
    );

    expect(exitCode).toBe(1);
    // The credential and where it was looked for, which is what the caller
    // needs and what "HTTP 401: Unauthorized" never said.
    expect(written.join("")).toContain("PATCHER_APP_KEY");
  });

  it("waits for output larger than 64 KiB to flush before returning", async () => {
    const stdout = "x".repeat(1024 * 1024);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ exitCode: 0, stdout, stderr: "warning" }),
            { status: 200 },
          ),
      ),
    );
    const writes: Array<{ channel: "stdout" | "stderr"; value: string }> = [];
    let pendingWrites = 0;
    const outputStream = (channel: "stdout" | "stderr") => ({
      write(value: string, callback: (error?: Error | null) => void) {
        pendingWrites += 1;
        setTimeout(() => {
          writes.push({ channel, value });
          pendingWrites -= 1;
          callback();
        }, 0);
        return false;
      },
    });

    const exitCode = await runPluginCliCommand(
      "http://localhost",
      "fixture",
      [],
      { stdout: outputStream("stdout"), stderr: outputStream("stderr") },
    );

    expect(exitCode).toBe(0);
    expect(pendingWrites).toBe(0);
    expect(writes).toEqual([
      { channel: "stdout", value: `${stdout}\n` },
      { channel: "stderr", value: "warning\n" },
    ]);
  });
});
