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

  let dataDir: string;
  const posted: { label: string; level: string }[] = [];
  const revoke = vi.fn(async () => ({ grants: [] }));

  const printed = () =>
    vi
      .mocked(console.log)
      .mock.calls.map((args) => args.join(" "))
      .join("\n");

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "patcher-agent-access-"));
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

    const keyFile = join(dataDir, "agent-keys", "bag_1.key");
    expect((await readFile(keyFile, "utf8")).trim()).toBe(`pa1.bag_1.${MAC}`);
    expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
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
      keyFile: join(dataDir, "agent-keys", "bag_1.key"),
    });
  });

  it("takes the grant back when its key cannot be written", async () => {
    // Shown nowhere else, the key of a grant whose file was never written is
    // a live credential nobody holds.
    await mkdir(join(dataDir, "agent-keys"), { recursive: true });
    await writeFile(join(dataDir, "agent-keys", "bag_1.key"), "not ours\n");

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
      `PATCHER_AGENT_KEY_FILE=${join(dataDir, "agent-keys", "bag_1.key")}`,
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
