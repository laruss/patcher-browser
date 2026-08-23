import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  pluginPermissionsFromManifest,
} from "@patcher/plugin-sdk/testing";
import plugin, { MAX_CUSTOM_INSTRUCTIONS_LENGTH } from "./server";

describe("custom instructions plugin", () => {
  it("loads persisted instructions and contributes them to agent tasks", async () => {
    const { patcher, harness } = createFakePluginHost({
      permissions: pluginPermissionsFromManifest(import.meta.url),
      pluginId: "custom-instructions",
    });
    await patcher.storage.kv.set("customInstructions", "Use concise answers.");

    await plugin(patcher);

    expect(await harness.callRpc("getInstructions")).toEqual({
      instructions: "Use concise answers.",
      maxLength: MAX_CUSTOM_INSTRUCTIONS_LENGTH,
    });
    expect(
      harness.registrations.instructionProvider?.({
        threadId: "thr_1",
        projectId: "proj_1",
      }),
    ).toBe("Use concise answers.");
  });

  it("persists saves and applies them immediately", async () => {
    const { patcher, harness } = createFakePluginHost({
      permissions: pluginPermissionsFromManifest(import.meta.url),
      pluginId: "custom-instructions",
    });
    await plugin(patcher);

    await expect(
      harness.callRpc("saveInstructions", {
        instructions: "Always run focused tests.",
      }),
    ).resolves.toEqual({
      instructions: "Always run focused tests.",
      maxLength: MAX_CUSTOM_INSTRUCTIONS_LENGTH,
    });
    await expect(patcher.storage.kv.get("customInstructions")).resolves.toBe(
      "Always run focused tests.",
    );
    expect(
      harness.registrations.instructionProvider?.({
        threadId: "thr_1",
        projectId: "proj_1",
      }),
    ).toBe("Always run focused tests.");
  });

  it("provides CLI parity for reading and updating instructions", async () => {
    const { patcher, harness } = createFakePluginHost({
      permissions: pluginPermissionsFromManifest(import.meta.url),
      pluginId: "custom-instructions",
    });
    await plugin(patcher);

    await expect(
      harness.runCli(["set", "Prefer", "small", "commits.", "--json"]),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: JSON.stringify({ instructions: "Prefer small commits." }),
    });
    await expect(harness.runCli(["get"])).resolves.toMatchObject({
      exitCode: 0,
      stdout: "Prefer small commits.",
    });
    await expect(patcher.storage.kv.get("customInstructions")).resolves.toBe(
      "Prefer small commits.",
    );
  });

  it("contributes nothing for blank text and rejects malformed or oversized saves", async () => {
    const { patcher, harness } = createFakePluginHost({
      permissions: pluginPermissionsFromManifest(import.meta.url),
      pluginId: "custom-instructions",
    });
    await plugin(patcher);

    expect(
      harness.registrations.instructionProvider?.({
        threadId: "thr_1",
        projectId: "proj_1",
      }),
    ).toBeNull();
    await expect(
      harness.callRpc("saveInstructions", { instructions: 42 }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      issues: expect.any(Array),
    });
    await expect(
      harness.callRpc("saveInstructions", {
        instructions: "x".repeat(MAX_CUSTOM_INSTRUCTIONS_LENGTH + 1),
      }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      issues: expect.any(Array),
    });
    await expect(
      harness.callRpc("saveInstructions", {
        instructions: "ok",
        ignored: true,
      }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      issues: expect.any(Array),
    });
    await expect(
      harness.callRpc("getInstructions", { ignored: true }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      issues: expect.any(Array),
    });
  });
});
