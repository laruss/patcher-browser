import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultAppSettings } from "@patcher/domain";
import {
  createConnection,
  getAnsweredCliSkills,
  migrate,
  setAppSettings,
  setAnsweredCliSkills,
  type DbConnection,
} from "../../src/index.js";

/**
 * The answers about skills for agents outside Patcher that shipped after the
 * first yes (#142). Unreadable text reads as no answers rather than as a
 * decline, so a skill is never silently skipped forever.
 */
describe("the answers about newly shipped skills", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
  });

  it("is empty on an install with no settings row", () => {
    expect(getAnsweredCliSkills(db)).toEqual({});
  });

  it("is empty on a row written before the question existed", () => {
    db.$client
      .prepare("INSERT INTO app_settings (id, updated_at) VALUES ('current', 1)")
      .run();

    expect(getAnsweredCliSkills(db)).toEqual({});
  });

  it("keeps an answer per skill", () => {
    setAnsweredCliSkills(db, { "patcher-browser": "declined" });
    setAnsweredCliSkills(db, {
      "patcher-browser": "declined",
      "patcher-notes": "accepted",
    });

    expect(getAnsweredCliSkills(db)).toEqual({
      "patcher-browser": "declined",
      "patcher-notes": "accepted",
    });
  });

  it("is left alone by a general settings write, which every window sends whole", () => {
    setAnsweredCliSkills(db, { "patcher-notes": "declined" });

    setAppSettings(db, defaultAppSettings);

    expect(getAnsweredCliSkills(db)).toEqual({ "patcher-notes": "declined" });
  });

  it("is empty when the stored text is not answers", () => {
    setAnsweredCliSkills(db, { "patcher-browser": "accepted" });
    db.$client.prepare("UPDATE app_settings SET cli_skills_answered = '{'").run();
    expect(getAnsweredCliSkills(db)).toEqual({});

    db.$client
      .prepare("UPDATE app_settings SET cli_skills_answered = '{\"a\":\"maybe\"}'")
      .run();
    expect(getAnsweredCliSkills(db)).toEqual({});
  });
});
