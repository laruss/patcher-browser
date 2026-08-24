import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimPluginScheduledRun,
  createConnection,
  listDuePluginSchedules,
  listPluginSchedules,
  migrate,
  recordPluginScheduleResult,
  upsertPluginSchedule,
  type DbConnection,
} from "../../src/index.js";

/**
 * What a load may and may not do to a schedule row.
 *
 * The case these are here for: a plugin load used to recompute `next_run_at`
 * unconditionally, so a tick that came due while the plugin was not loaded was
 * pushed into the future instead of run. On a desktop app that is closed
 * overnight, a daily schedule was silently never due.
 */
describe("plugin schedule registration", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
  });

  afterEach(() => db.$client.close());

  const DAILY = "0 9 * * *";

  function register(cron: string, nextRunAt: number): void {
    upsertPluginSchedule(db, {
      pluginId: "news",
      name: "digest",
      cron,
      nextRunAt,
    });
  }

  function row() {
    return listPluginSchedules(db, "news")[0];
  }

  it("inserts a first registration with the time it was given", () => {
    const at = Date.now() + 3_600_000;
    register(DAILY, at);
    expect(row()).toMatchObject({
      name: "digest",
      cron: DAILY,
      nextRunAt: at,
      lastStatus: null,
    });
  });

  it("keeps a run that came due while the plugin was not loaded", () => {
    const missed = Date.now() - 3 * 3_600_000;
    register(DAILY, missed);
    // The load a restart performs: same cron, and a freshly computed time that
    // is necessarily in the future.
    register(DAILY, Date.now() + 20 * 3_600_000);
    expect(row()?.nextRunAt).toBe(missed);
    // And it is due, so the next sweep picks it up rather than skipping a day.
    expect(
      listDuePluginSchedules(db, { now: Date.now(), limit: 10 }),
    ).toHaveLength(1);
  });

  it("stays due across repeated loads, so a restart loop cannot starve it", () => {
    const missed = Date.now() - 3_600_000;
    register(DAILY, missed);
    for (let load = 0; load < 5; load += 1) {
      register(DAILY, Date.now() + 20 * 3_600_000);
    }
    expect(row()?.nextRunAt).toBe(missed);
  });

  it("leaves a future time alone as well", () => {
    const scheduled = Date.now() + 20 * 3_600_000;
    register(DAILY, scheduled);
    register(DAILY, scheduled + 60_000);
    expect(row()?.nextRunAt).toBe(scheduled);
  });

  it("recomputes when the plugin changed the cron", () => {
    register(DAILY, Date.now() - 3_600_000);
    const rescheduled = Date.now() + 90_000;
    register("*/5 * * * *", rescheduled);
    expect(row()).toMatchObject({
      cron: "*/5 * * * *",
      nextRunAt: rescheduled,
    });
  });

  it("keeps run history across a load either way", () => {
    register(DAILY, Date.now() - 3_600_000);
    const claimed = claimPluginScheduledRun(db, {
      pluginId: "news",
      name: "digest",
      expectedNextRunAt: row()?.nextRunAt ?? 0,
      newNextRunAt: Date.now() + 20 * 3_600_000,
      now: 1_000,
    });
    expect(claimed).toBe(true);
    recordPluginScheduleResult(db, {
      pluginId: "news",
      name: "digest",
      status: "error",
      error: "the feed timed out",
      now: 2_000,
    });

    register(DAILY, Date.now() + 20 * 3_600_000);
    expect(row()).toMatchObject({
      lastRunAt: 1_000,
      lastStatus: "error",
      lastError: "the feed timed out",
    });

    register("*/5 * * * *", Date.now() + 60_000);
    expect(row()).toMatchObject({
      lastRunAt: 1_000,
      lastStatus: "error",
      lastError: "the feed timed out",
    });
  });

  it("runs a caught-up tick once, then follows the cron", () => {
    const missed = Date.now() - 3_600_000;
    register(DAILY, missed);
    register(DAILY, Date.now() + 20 * 3_600_000);

    const due = listDuePluginSchedules(db, { now: Date.now(), limit: 10 });
    expect(due).toHaveLength(1);
    const resumed = Date.now() + 20 * 3_600_000;
    expect(
      claimPluginScheduledRun(db, {
        pluginId: "news",
        name: "digest",
        expectedNextRunAt: due[0]?.nextRunAt ?? 0,
        newNextRunAt: resumed,
        now: Date.now(),
      }),
    ).toBe(true);

    expect(row()?.nextRunAt).toBe(resumed);
    expect(
      listDuePluginSchedules(db, { now: Date.now(), limit: 10 }),
    ).toHaveLength(0);
  });
});
