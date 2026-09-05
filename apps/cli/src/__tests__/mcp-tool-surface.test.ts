import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Command } from "commander";

import { mcpToolArgvRefusal } from "../commands/mcp-serve.js";
import { registerPatcherCommands } from "../register-commands.js";

/**
 * Which of this CLI's commands a turn can reach through the MCP tool.
 *
 * The tool spawns the CLI outside the turn's sandbox, so the question is not
 * what the CLI may do — it is what it may do at a path nothing bounds. Asked
 * against the program the binary builds rather than a list written here: a
 * hand-copied list would answer about the copy.
 *
 * Two checks, because one of them cannot see everything. The first pins the
 * commands the tool refuses, so a new *family* — which the allow-list closes on
 * arrival — cannot be closed silently, and an existing refusal cannot be dropped
 * by accident. The second asks which modules can touch this machine at all, so a
 * new command file that reads or writes or spawns has to be looked at here. What
 * neither sees is a new subcommand added *inside* one of the modules already
 * counted, under a family the tool allows; that one is left to review, and it is
 * why the second check names the modules rather than counting them.
 */

const SOURCE_DIR = fileURLToPath(new URL("..", import.meta.url));

function leafCommandPaths(command: Command, prefix = ""): string[] {
  return command.commands.flatMap((sub) => {
    const path = prefix ? `${prefix} ${sub.name()}` : sub.name();
    return sub.commands.length === 0 ? [path] : leafCommandPaths(sub, path);
  });
}

function patcherProgram(): Command {
  const program = new Command();
  registerPatcherCommands(program, {
    getUrl: () => "http://127.0.0.1:38986",
    getContext: () => ({ serverUrl: "http://127.0.0.1:38986" }),
  });
  return program;
}

/** Every `.ts` under `apps/cli/src`, tests aside. */
async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "__tests__" ? [] : await sourceFiles(path);
      }
      return entry.name.endsWith(".ts") ? [path] : [];
    }),
  );
  return files.flat();
}

/** A shell holding a browser access grant instead of a thread credential. */
const GRANT_ENV = { PATCHER_AGENT_KEY: "pa1.bag_x.mac" };

describe("the CLI a turn reaches through the MCP tool", () => {
  it("refuses the commands that act on this machine rather than on the API", () => {
    const leaves = leafCommandPaths(patcherProgram());

    // A check whose evidence can be empty is not a check.
    expect(leaves.length).toBeGreaterThan(100);
    expect(
      leaves
        // An explicit environment, because the default is `process.env` and a
        // shell that exported `PATCHER_AGENT_KEY` — which this feature tells
        // people to do — would put the tool in grant mode and refuse nearly
        // everything, so the assertion below would be about the shell rather
        // than about the code.
        .filter((path) => mcpToolArgvRefusal(path.split(" "), {}) !== null)
        .sort(),
    ).toEqual([
      // Minting, listing and revoking a credential for an agent outside
      // Patcher. The server refuses a turn the mutation already — a grant
      // outlives the turn a thread key dies with — and the whole group is off
      // the tool rather than only the two mutations: a turn that can read the
      // list has learnt nothing it can use, and the person's own terminal is
      // where this belongs.
      "agent-access grant",
      "agent-access list",
      "agent-access pause",
      "agent-access resume",
      "agent-access revoke",
      // Serving the tool from inside the tool.
      "mcp-serve",
      // Authoring and building a plugin is work on this machine: `plugin types`
      // wrote a file into a directory of the caller's choosing with no server
      // involved at all, and `build` and `dev` run npm and tsc there.
      "plugin build",
      "plugin config",
      "plugin dev",
      "plugin disable",
      "plugin enable",
      "plugin install",
      "plugin list",
      "plugin logs",
      "plugin new",
      "plugin outdated",
      "plugin reload",
      "plugin remove",
      "plugin run",
      "plugin search",
      "plugin source",
      "plugin token",
      "plugin types",
      "plugin update",
      // `--client-file` names a path on this machine, in both directions.
      "project attachment download",
      "project attachment upload",
      // `--file` is the replacement SKILL.md, read from this machine.
      "skill update",
      // The audio file, likewise.
      "voice transcribe",
    ]);
  });

  it("offers only the browser when it holds a browser access grant", async () => {
    // The other transport this command serves. A grant reaches two routes, so
    // every command in the turn-mode list would come back a 403 with a
    // paragraph about credentials — and a model told only "no" tries the
    // neighbour. The whole surface is asserted, not a sample.
    const leaves = leafCommandPaths(patcherProgram());
    expect(leaves.length).toBeGreaterThan(100);

    const allowed = leaves.filter(
      (path) => mcpToolArgvRefusal(path.split(" "), GRANT_ENV) === null,
    );

    expect(allowed).toEqual([]);
    // `browser` is a plugin contribution, so it is not a leaf of this program
    // at all — which is the point: it is admitted by name.
    expect(mcpToolArgvRefusal(["browser", "tabs"], GRANT_ENV)).toBeNull();
    expect(mcpToolArgvRefusal(["thread", "list"], GRANT_ENV)).toContain(
      "browser access grant",
    );
  });

  it("is served by the modules that can touch this machine, and no others", async () => {
    const files = await sourceFiles(SOURCE_DIR);
    const touching = await Promise.all(
      files.map(async (file) => {
        const source = await readFile(file, "utf8");
        return /"node:fs(\/promises)?"|"node:child_process"/.test(source)
          ? [file.slice(SOURCE_DIR.length)]
          : [];
      }),
    );

    expect(files.length).toBeGreaterThan(20);
    expect(touching.flat().sort()).toEqual([
      // Runs the *agent's* own `mcp add`, so it never edits their config file
      // itself, and looks for the CLI shim to point that config at. Refused
      // through the tool, like every other module here.
      "commands/agent-access.ts",
      // The tool's own transport: it spawns the CLI, and this is where the argv
      // is refused before it does.
      "commands/mcp-serve.ts",
      // Refused through the tool — each opens a path this process does not
      // bound. A new one belongs in `MCP_TOOL_REFUSED_COMMANDS` first.
      "commands/plugin.ts",
      "commands/project.ts",
      "commands/skill.ts",
      "commands/voice.ts",
      // Neither is a command: one hops to the daemon-managed binary before
      // commander runs, the other reads this package's own version.
      "patcher-cli-reexec.ts",
      "version.ts",
    ]);
  });
});
