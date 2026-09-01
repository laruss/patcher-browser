import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultAppSettings } from "@patcher/domain";
import {
  createConnection,
  getAppKeybindingOverrides,
  getAppSettings,
  migrate,
  setAppKeybindingOverrides,
  setAppSettings,
  type DbConnection,
} from "../../src/index.js";

describe("app settings data", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
  });

  it("round-trips the egress host list, which is text holding JSON", () => {
    setAppSettings(db, {
      ...defaultAppSettings,
      providerEgressConfined: true,
      providerEgressAllowedHosts: ["github.com", "*.githubusercontent.com"],
    });

    expect(getAppSettings(db)).toEqual({
      ...defaultAppSettings,
      providerEgressConfined: true,
      providerEgressAllowedHosts: ["github.com", "*.githubusercontent.com"],
    });
  });

  it("reads an unparseable host list as an empty one", () => {
    // Every other setting is typed at the column and cannot arrive malformed.
    // This one is text, so a row written by a future version — or by hand —
    // must not take the whole settings endpoint down with it.
    setAppSettings(db, defaultAppSettings);
    db.$client
      .prepare(
        "UPDATE app_settings SET provider_egress_allowed_hosts = 'not json'",
      )
      .run();

    expect(getAppSettings(db).providerEgressAllowedHosts).toEqual([]);
  });

  it("persists keyboard overrides without clobbering general settings", () => {
    const overrides = [
      { command: "thread.new" as const, shortcut: null },
    ];
    setAppSettings(db, {
      ...defaultAppSettings,
      caffeinate: true,
      showKeyboardHints: false,
      steerActiveThreadOnEnter: true,
      codexMemoryEnabled: false,
    });
    setAppKeybindingOverrides(db, overrides);

    expect(getAppSettings(db)).toEqual({
      ...defaultAppSettings,
      caffeinate: true,
      showKeyboardHints: false,
      steerActiveThreadOnEnter: true,
      codexMemoryEnabled: false,
    });
    expect(getAppKeybindingOverrides(db)).toEqual(overrides);

    setAppSettings(db, defaultAppSettings);
    expect(getAppKeybindingOverrides(db)).toEqual(overrides);
  });
});
