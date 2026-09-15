import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentAccessGrantArgv,
  agentAccessRequestArgv,
  resolveCliShimPath,
} from "@patcher/config/cli-shim";
import { BROWSER_ACCESS_GRANT_LEVELS } from "@patcher/domain";
import {
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerAgentAccessCommands } from "../../commands/agent-access.js";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: execFileMock,
}));

/**
 * Issuing a grant from a terminal an agent may be reading.
 *
 * Walked through on 2026-09-14: run from the agent's own session, the key the
 * command printed landed in the chat transcript and its session log (#134). So
 * what is asserted is what reaches stdout, and that the key is somewhere else.
 */

/** The part of every key a leak would show. */
const MAC = "secret-mac-value";
const SERVER_URL = "http://127.0.0.1:38986";

describe("patcher agent-access grant", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerAgentAccessCommands(program, () => "http://server");

  /** The server's data dir, as `system.config` reports it. */
  let dataDir: string;
  /** This machine's, where the key file goes. */
  let localDir: string;
  const posted: { label: string; level: string }[] = [];
  const revoke = vi.fn(async () => ({ grants: [] }));

  const printed = () =>
    vi
      .mocked(console.log)
      .mock.calls.map((args) => args.join(" "))
      .join("\n");

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "patcher-agent-access-"));
    localDir = await mkdtemp(join(tmpdir(), "patcher-agent-access-local-"));
    vi.stubEnv("PATCHER_DATA_DIR", localDir);
    posted.length = 0;
    revoke.mockClear();
    execFileMock.mockReset();
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        dataDir,
        serverUrl: SERVER_URL,
      })),
      "v1.browser.access-grants.$post": vi.fn(
        async ({ json }: { json: { label: string; level: string } }) => {
          posted.push(json);
          const id = `bag_${posted.length}`;
          return {
            grant: {
              id,
              label: json.label,
              level: json.level,
              createdAt: 0,
              lastUsedAt: null,
              pausedAt: null,
              revokedAt: null,
            },
            key: `pa1.${id}.${MAC}`,
            browserToolsEnabled: true,
          };
        },
      ),
      "v1.browser.access-grants.:id.$delete": revoke,
    });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(localDir, { recursive: true, force: true });
  });

  it("writes the key to a file only its owner reads, and prints the path instead", async () => {
    const shim = resolveCliShimPath(dataDir);
    await mkdir(join(dataDir, "bin"), { recursive: true });
    await writeFile(shim, "#!/bin/sh\n");
    await chmod(shim, 0o755);

    await runCommand(
      ["agent-access", "grant", "Claude Code", "--level", "browse"],
      register,
    );

    const keyFile = join(localDir, "agent-keys", "bag_1.key");
    expect((await readFile(keyFile, "utf8")).trim()).toBe(`pa1.bag_1.${MAC}`);
    expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
    // On this machine rather than under the server's data dir: a CLI pointed
    // at a server elsewhere cannot write there, and its agent runs here.
    await expect(stat(join(dataDir, "agent-keys"))).rejects.toThrow();
    expect(printed()).not.toContain(MAC);
    expect(printed()).toContain(`export PATCHER_AGENT_KEY_FILE=${keyFile}`);
    // The shim exports the server URL itself, so the agent is sent to it
    // rather than handed a second variable to carry.
    expect(printed()).toContain(`run Patcher as ${shim}`);
  });

  it("names a Patcher to run when this install has no shim", async () => {
    // `patcher` is usually not on PATH, so two exports and no command would
    // leave the agent with nothing to run. This CLI's own entry point is the
    // fallback, and it needs the server URL spelled out.
    await runCommand(["agent-access", "grant", "Claude Code"], register);

    expect(printed()).toContain(`export PATCHER_SERVER_URL=${SERVER_URL}`);
    expect(printed()).toContain(`run Patcher as ${process.execPath}`);
    expect(printed()).not.toContain(MAC);
  });

  it("prints the key only when asked to", async () => {
    await runCommand(
      ["agent-access", "grant", "Claude Code", "--print-key"],
      register,
    );

    expect(printed()).toContain(`export PATCHER_AGENT_KEY=pa1.bag_1.${MAC}`);
  });

  it("leaves the key out of --json as well, since that is stdout too", async () => {
    await runCommand(
      ["agent-access", "grant", "Claude Code", "--json"],
      register,
    );

    expect(printed()).not.toContain(MAC);
    expect(JSON.parse(printed())).toMatchObject({
      keyFile: join(localDir, "agent-keys", "bag_1.key"),
    });
  });

  it("takes the grant back when its key cannot be written", async () => {
    // Shown nowhere else, the key of a grant whose file was never written is
    // a live credential nobody holds.
    await mkdir(join(localDir, "agent-keys"), { recursive: true });
    await writeFile(join(localDir, "agent-keys", "bag_1.key"), "not ours\n");

    await expect(
      runCommand(["agent-access", "grant", "Claude Code"], register),
    ).rejects.toThrow("process.exit:1");

    expect(revoke).toHaveBeenCalledWith({ param: { id: "bag_1" } });
    expect(printed()).not.toContain(MAC);
    expect(
      vi
        .mocked(console.error)
        .mock.calls.map((args) => args.join(" "))
        .join("\n"),
    ).toContain("was revoked");
  });

  it("hands Claude Code the key's file rather than the key, and says to restart it", async () => {
    execFileMock.mockImplementation(
      (
        _binary: string,
        _argv: string[],
        callback: (error: null, result: { stdout: string }) => void,
      ) => callback(null, { stdout: "" }),
    );

    await runCommand(
      ["agent-access", "grant", "Claude Code", "--for", "claude-code"],
      register,
    );

    const [binary, argv] = execFileMock.mock.calls[0] as [string, string[]];
    expect(binary).toBe("claude");
    // The argv is printed, visible in `ps`, and written into their config.
    expect(argv).toContain(
      `PATCHER_AGENT_KEY_FILE=${join(localDir, "agent-keys", "bag_1.key")}`,
    );
    expect(argv.join(" ")).not.toContain(MAC);
    expect(printed()).not.toContain(MAC);
    expect(printed()).toContain("Restart Claude Code");
  });

  it("parses every grant command a refusal suggests", async () => {
    // The server's refusals print `agentAccessGrantArgv` through the shim.
    // Fed here to the command's own definition, so a suggestion that does not
    // run fails in this test rather than in front of a person — including a
    // label that looks like an option.
    const labels = ["Claude Code", "it's mine", "<your name>", "-x", "--level"];

    for (const level of BROWSER_ACCESS_GRANT_LEVELS) {
      for (const label of labels) {
        await runCommand(agentAccessGrantArgv(label, level), register);
      }
    }

    expect(posted).toEqual(
      BROWSER_ACCESS_GRANT_LEVELS.flatMap((level) =>
        labels.map((label) => ({ label, level })),
      ),
    );
  });
});

/**
 * An agent asking for itself, and waiting on the person's answer (#135).
 *
 * The agent runs this, so everything it prints lands in its transcript: the key
 * must not, and a wait must end well before the agent's own tool timeout.
 */
describe("patcher agent-access request", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerAgentAccessCommands(program, () => "http://server");

  let dataDir: string;
  let localDir: string;
  const asked: { label: string; level: string; reason?: string }[] = [];
  /** What each poll answers, in turn; the last one repeats. */
  let outcomes: ((grantNumber: number) => object)[] = [];
  let polls = 0;

  const printed = () =>
    vi
      .mocked(console.log)
      .mock.calls.map((args) => args.join(" "))
      .join("\n");
  const errored = () =>
    vi
      .mocked(console.error)
      .mock.calls.map((args) => args.join(" "))
      .join("\n");

  const approved =
    (level: string) =>
    (n: number): object => ({
      outcome: "approved",
      grant: {
        id: `bag_${n}`,
        label: asked.at(-1)?.label ?? "",
        level,
        createdAt: 0,
        lastUsedAt: null,
        pausedAt: null,
        revokedAt: null,
      },
      key: `pa1.bag_${n}.${MAC}`,
      browserToolsEnabled: true,
    });
  /**
   * Run a command whose waits are on the fake clock, advancing it until the
   * command settles. The command does real file I/O before its first wait, so
   * one advance up front would fire before anything was waiting on it.
   */
  /**
   * The fake time at which the command printed that it is waiting, which is
   * when its 90 seconds start. Measured from there rather than from the test's
   * start: the file I/O before it is real, and `runOnFakeClock` keeps the clock
   * moving through it — on a loaded CI runner, far enough to fail a bound that
   * the command itself kept (measured: 160.5 s from the start, #139).
   */
  const recordWhenAsked = (): (() => number) => {
    let at = Number.NaN;
    vi.mocked(console.log).mockImplementation((...args: unknown[]) => {
      if (String(args[0]).startsWith("Asked the person")) at = Date.now();
    });
    return () => at;
  };
  const runOnFakeClock = async (argv: string[]): Promise<unknown> => {
    let settled = false;
    const run = runCommand(argv, register).finally(() => {
      settled = true;
    });
    run.catch(() => {});
    for (let step = 0; !settled && step < 1_000; step += 1) {
      await vi.advanceTimersByTimeAsync(500);
      await new Promise((resolve) => setImmediate(resolve));
    }
    return run;
  };
  const pending = () => ({
    outcome: "pending",
    request: {
      id: "bar_1",
      label: "x",
      level: "browse",
      reason: null,
      createdAt: 0,
      expiresAt: 600_000,
    },
  });

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "patcher-agent-access-"));
    localDir = await mkdtemp(join(tmpdir(), "patcher-agent-access-local-"));
    vi.stubEnv("PATCHER_DATA_DIR", localDir);
    asked.length = 0;
    outcomes = [];
    polls = 0;
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        dataDir,
        serverUrl: SERVER_URL,
      })),
      "v1.browser.access-requests.$post": vi.fn(
        async ({
          json,
        }: {
          json: { label: string; level: string; reason?: string };
        }) => {
          asked.push(json);
          return {
            request: {
              id: `bar_${asked.length}`,
              label: json.label,
              level: json.level,
              reason: json.reason ?? null,
              createdAt: 0,
              expiresAt: 600_000,
            },
          };
        },
      ),
      "v1.browser.access-requests.:id.outcome.$post": vi.fn(async () => {
        polls += 1;
        const next = outcomes[Math.min(polls, outcomes.length) - 1];
        return next?.(asked.length) ?? pending();
      }),
      "v1.browser.access-grants.:id.$delete": vi.fn(async () => ({
        grants: [],
      })),
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dataDir, { recursive: true, force: true });
    await rm(localDir, { recursive: true, force: true });
  });

  it("waits for the person, then hands over the key in a file and never prints it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    outcomes = [pending, approved("browse")];

    await runOnFakeClock([
      "agent-access",
      "request",
      "Claude Code",
      "--level",
      "browse",
      "--reason",
      "read the docs page you linked",
    ]);

    expect(asked).toEqual([
      {
        label: "Claude Code",
        level: "browse",
        reason: "read the docs page you linked",
      },
    ]);
    expect(polls).toBe(2);
    const keyFile = join(localDir, "agent-keys", "bag_1.key");
    expect((await readFile(keyFile, "utf8")).trim()).toBe(`pa1.bag_1.${MAC}`);
    expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
    expect(printed()).toContain("Patcher's window");
    // `request` has no `--print-key`, so it must not point at one — found on a
    // packaged build, where the line shared with `grant` said it did.
    expect(printed()).not.toContain("--print-key");
    expect(printed()).toContain(`export PATCHER_AGENT_KEY_FILE=${keyFile}`);
    expect(printed()).not.toContain(MAC);
  });

  it("says so when the person allowed less than was asked", async () => {
    outcomes = [approved("read")];

    await runCommand(
      ["agent-access", "request", "Claude Code", "--level", "interact"],
      register,
    );

    expect(printed()).toContain(
      `allowed "Claude Code" at "read", lower than the "interact" asked for`,
    );
  });

  it("stops at a no, and says not to go round it", async () => {
    outcomes = [() => ({ outcome: "denied" })];

    await expect(
      runCommand(
        ["agent-access", "request", "Claude Code", "--level", "browse"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(errored()).toContain("answered no");
    expect(errored()).toContain("do not run `agent-access grant`");
    await expect(
      stat(join(localDir, "agent-keys", "bag_1.key")),
    ).rejects.toThrow();
  });

  it("gives up well inside an agent's tool timeout, and says the request is still open", async () => {
    // Claude Code's shell tool stops a command at 120 seconds; killed there,
    // this would have reported nothing at all.
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const askedAt = recordWhenAsked();

    await expect(
      runOnFakeClock([
        "agent-access",
        "request",
        "Claude Code",
        "--level",
        "browse",
      ]),
    ).rejects.toThrow("process.exit:1");

    expect(Date.now() - askedAt()).toBeLessThan(120_000);
    expect(errored()).toContain("run the same command again");
    expect(printed()).not.toContain(MAC);
  });

  it("gives up on time even when one poll never answers", async () => {
    // A server elsewhere on a bad network: the deadline has to bound the poll
    // in the air, not only the gaps between polls.
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    outcomes = [() => new Promise<object>(() => {})];
    const askedAt = recordWhenAsked();

    await expect(
      runOnFakeClock([
        "agent-access",
        "request",
        "Claude Code",
        "--level",
        "browse",
      ]),
    ).rejects.toThrow("process.exit:1");

    expect(Date.now() - askedAt()).toBeLessThan(120_000);
    expect(errored()).toContain("run the same command again");
  });

  it("will not ask without a level", async () => {
    await expect(
      runCommand(["agent-access", "request", "Claude Code"], register),
    ).rejects.toThrow();

    expect(asked).toEqual([]);
  });

  it("parses every request command a refusal suggests", async () => {
    // The refusal for a caller with no grant tells it to run this itself, so
    // it is the one suggestion most likely to be run exactly as printed.
    outcomes = [approved("read")];
    const labels = ["Claude Code", "it's mine", "<your name>", "-x", "--level"];

    // With the reason the refusal fills in as well: the label follows `--`, so
    // a reason the reader appended itself would not have parsed.
    const reason = "<what you need it for>";
    for (const level of BROWSER_ACCESS_GRANT_LEVELS) {
      for (const label of labels) {
        await runCommand(agentAccessRequestArgv(label, level), register);
        await runCommand(
          agentAccessRequestArgv(label, level, reason),
          register,
        );
      }
    }

    expect(asked).toEqual(
      BROWSER_ACCESS_GRANT_LEVELS.flatMap((level) =>
        labels.flatMap((label) => [
          { label, level },
          { label, level, reason },
        ]),
      ),
    );
  });
});
