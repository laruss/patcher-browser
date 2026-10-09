import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConnection,
  migrate,
  setPluginSettingsValues,
} from "@patcher/db";
import {
  buildPluginSettingsView,
  readPluginSettingsValues,
  type PluginSettingsStoreArgs,
} from "../../../src/services/plugins/plugin-settings.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
    stat: vi.fn(actual.stat),
  };
});

const actualFs =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

describe("plugin settings metadata", () => {
  let args: PluginSettingsStoreArgs;
  let dataDir: string;

  beforeEach(async () => {
    vi.mocked(readFile).mockReset().mockImplementation(actualFs.readFile);
    vi.mocked(stat).mockReset().mockImplementation(actualFs.stat);
    dataDir = await mkdtemp(join(tmpdir(), "patcher-settings-view-test-"));
    const db = createConnection(":memory:");
    migrate(db);
    args = {
      db,
      dataDir,
      pluginId: "fixture",
      descriptors: {
        savedToken: { type: "string", label: "Saved token", secret: true },
        emptyToken: { type: "string", label: "Empty token", secret: true },
        defaultToken: {
          type: "string",
          label: "Default token",
          description: "An existing secret default",
          secret: true,
          default: "fixture-default-secret",
        },
        note: { type: "string", label: "Note", default: "hello" },
        enabled: { type: "boolean", label: "Enabled", default: false },
        mode: {
          type: "select",
          label: "Mode",
          options: ["fast", "slow"],
          default: "fast",
        },
        project: { type: "project", label: "Project", default: "project-1" },
        optional: { type: "string", label: "Optional" },
      },
    };
    const secretsDir = join(dataDir, "plugins", "fixture", "secrets");
    await mkdir(secretsDir, { recursive: true });
    await writeFile(join(secretsDir, "savedToken"), "fixture-saved-secret");
    await writeFile(join(secretsDir, "emptyToken"), "");
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("builds public metadata without reading secrets or exposing their defaults", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("secret reads forbidden"));

    const view = await buildPluginSettingsView(args);

    expect(readFile).not.toHaveBeenCalled();
    expect(view.values).toEqual({
      savedToken: { set: true },
      emptyToken: { set: true },
      defaultToken: { set: false },
      note: "hello",
      enabled: false,
      mode: "fast",
      project: "project-1",
    });
    expect(JSON.stringify(view)).not.toContain("fixture-saved-secret");
    expect(JSON.stringify(view)).not.toContain("fixture-default-secret");
    expect(view.schema.defaultToken).toEqual({
      type: "string",
      label: "Default token",
      description: "An existing secret default",
      secret: true,
    });
    expect(view.schema.note).toEqual(args.descriptors.note);
    expect(view.schema).not.toBe(args.descriptors);
    expect(args.descriptors.defaultToken).toHaveProperty(
      "default",
      "fixture-default-secret",
    );
  });

  it("preserves ordinary stored values and falls back from invalid values", async () => {
    setPluginSettingsValues(args.db, args.pluginId, {
      note: JSON.stringify("saved note"),
      enabled: JSON.stringify("invalid boolean"),
      mode: JSON.stringify("unknown option"),
      project: "invalid JSON",
    });
    vi.mocked(readFile).mockRejectedValue(new Error("secret reads forbidden"));

    const view = await buildPluginSettingsView(args);

    expect(view.values.note).toBe("saved note");
    expect(view.values.enabled).toBe(false);
    expect(view.values.mode).toBe("fast");
    expect(view.values.project).toBe("project-1");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("keeps secret defaults and saved values available to the owning plugin", async () => {
    await buildPluginSettingsView(args);

    const effective = await readPluginSettingsValues(args);

    expect(effective.savedToken).toBe("fixture-saved-secret");
    expect(effective.emptyToken).toBe("");
    expect(effective.defaultToken).toBe("fixture-default-secret");
  });

  it.each(["EACCES", "EIO"])(
    "propagates %s instead of reporting an unset secret",
    async (code) => {
      const error = Object.assign(new Error("metadata lookup failed"), {
        code,
      });
      vi.mocked(stat).mockRejectedValue(error);

      await expect(buildPluginSettingsView(args)).rejects.toBe(error);
    },
  );
});
