import { describe, expect, it, vi } from "vitest";
import * as domain from "@patcher/domain";
import {
  setupCommandOutputTestEnvironment,
  collectLogPayloads,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("patcher thread list command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("patcher thread list supports parent-thread filtering", async () => {
    const list = vi.fn(async () => []);
    stubServerApi({ "v1.threads.$get": list });

    await runCommand(
      [
        "thread",
        "list",
        "--project",
        "proj-1",
        "--parent-thread",
        "thread-manager-1",
      ],
      register,
    );

    expect(list).toHaveBeenCalledWith({
      query: {
        projectId: "proj-1",
        parentThreadId: "thread-manager-1",
      },
    });
  });

  it("patcher thread list opts into hidden threads explicitly", async () => {
    const list = vi.fn(async () => []);
    stubServerApi({ "v1.threads.$get": list });

    await runCommand(["thread", "list", "--include-hidden"], register);

    expect(list).toHaveBeenCalledWith({
      query: { includeHidden: "true" },
    });
  });

  it("patcher thread list rejects invalid parent-thread values", async () => {
    const list = vi.fn(async () => []);
    stubServerApi({ "v1.threads.$get": list });

    await expect(
      runCommand(
        [
          "thread",
          "list",
          "--project",
          "proj-1",
          "--parent-thread",
          "thread/invalid",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(console.error).toHaveBeenCalledWith(
      'Error: Invalid ID from --parent-thread: "thread/invalid". IDs must contain only letters, digits, hyphens, and underscores.',
    );
    expect(list).not.toHaveBeenCalled();
  });

  it("patcher thread list renders archived status in the shared borderless table", async () => {
    const list = vi.fn(async () => [
      fixtures.makeThread({
        id: "thread-archived-1",
        projectId: "proj-1",
        providerId: "codex",
        status: "idle",
        archivedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    ]);
    stubServerApi({ "v1.threads.$get": list });

    await runCommand(["thread", "list"], register);

    expect(list).toHaveBeenCalledWith({
      query: {},
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "",
      "ID                 Project  Status         \n-----------------  -------  ---------------\nthread-archived-1  proj-1   idle (archived)",
      "",
    ]);
  });

  it("patcher thread list renders pinned status in the shared borderless table", async () => {
    const list = vi.fn(async () => [
      fixtures.makeThread({
        id: "thread-pinned-1",
        projectId: "proj-1",
        providerId: "codex",
        status: "idle",
        pinnedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    ]);
    stubServerApi({ "v1.threads.$get": list });

    await runCommand(["thread", "list"], register);

    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "idle (pinned)",
    );
  });

  it("patcher thread list hides the personal project label", async () => {
    const list = vi.fn(async () => [
      fixtures.makeThread({
        id: "thread-personal-1",
        projectId: domain.PERSONAL_PROJECT_ID,
        providerId: "codex",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
      }),
    ]);
    stubServerApi({ "v1.threads.$get": list });

    vi.stubEnv("PATCHER_PROJECT_ID", undefined);
    await runCommand(["thread", "list"], register);

    expect(list).toHaveBeenCalledWith({
      query: {},
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "",
      "ID                 Project  Status      \n-----------------  -------  ------------\nthread-personal-1  -        idle        ",
      "",
    ]);
  });

  it("patcher thread list ignores PATCHER_PROJECT_ID when --project is omitted", async () => {
    const list = vi.fn(async () => []);
    stubServerApi({ "v1.threads.$get": list });

    vi.stubEnv("PATCHER_PROJECT_ID", "proj-env");
    await runCommand(["thread", "list"], register);

    expect(list).toHaveBeenCalledWith({
      query: {},
    });
  });

  it("patcher thread list does not infer parent-thread from PATCHER_THREAD_ID", async () => {
    const list = vi.fn(async () => []);

    stubServerApi({ "v1.threads.$get": list });

    vi.stubEnv("PATCHER_PROJECT_ID", "proj-env");
    vi.stubEnv("PATCHER_THREAD_ID", "thread-current");
    await runCommand(["thread", "list"], register);

    expect(list).toHaveBeenCalledWith({
      query: {},
    });
  });
});
