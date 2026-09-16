import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultAppSettings } from "@patcher/domain";
import {
  createConnection,
  getAppSettings,
  getCliCommandSetup,
  migrate,
  setAppSettings,
  setCliCommandSetup,
  type DbConnection,
} from "../../src/index.js";

/**
 * The answer to putting a bare `patcher` on the person's PATH (#147).
 *
 * The case that matters is the third: the answer lives in the same row as the
 * general settings, and those are written as whole objects by every window, so
 * a general write that carried the column would put `unasked` back and the
 * question would return.
 */
describe("the answer about the patcher command", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
  });

  it("is unasked on an install with no settings row", () => {
    expect(getCliCommandSetup(db)).toBe("unasked");
  });

  it("is unasked on a row written before the question existed", () => {
    db.$client
      .prepare(
        "INSERT INTO app_settings (id, updated_at) VALUES ('current', 1)",
      )
      .run();

    expect(getCliCommandSetup(db)).toBe("unasked");
  });

  it("survives a general settings write, which every window sends whole", () => {
    setCliCommandSetup(db, "declined");
    setAppSettings(db, { ...defaultAppSettings, caffeinate: true });

    expect(getCliCommandSetup(db)).toBe("declined");
    expect(getAppSettings(db).caffeinate).toBe(true);
  });

  it("leaves the general settings at their defaults when it creates the row", () => {
    setCliCommandSetup(db, "accepted");

    expect(getCliCommandSetup(db)).toBe("accepted");
    expect(getAppSettings(db)).toEqual(defaultAppSettings);
  });

  it("reads text nobody can parse as unasked", () => {
    setCliCommandSetup(db, "accepted");
    db.$client
      .prepare("UPDATE app_settings SET cli_command_setup = 'maybe'")
      .run();

    expect(getCliCommandSetup(db)).toBe("unasked");
  });
});
