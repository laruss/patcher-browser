import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BROWSER_HISTORY_MAX_ENTRIES,
  BROWSER_HISTORY_TITLE_MAX_LENGTH,
} from "@patcher/domain";
import {
  clearBrowserHistory,
  createConnection,
  deleteBrowserHistoryEntry,
  listBrowserHistoryEntries,
  migrate,
  recordBrowserHistoryVisit,
  type DbConnection,
} from "../../src/index.js";

describe("browser history data", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
  });

  it("counts a revisit instead of adding a second row", () => {
    recordBrowserHistoryVisit(db, {
      scopeId: "thr_a",
      url: "https://example.test/docs",
      title: "Docs",
      visitedAt: 1_000,
    });
    recordBrowserHistoryVisit(db, {
      scopeId: "thr_a",
      url: "https://example.test/docs",
      title: "Docs",
      visitedAt: 2_000,
    });

    expect(listBrowserHistoryEntries(db, { limit: 10 })).toEqual([
      expect.objectContaining({
        url: "https://example.test/docs",
        visitCount: 2,
        lastVisitedAt: 2_000,
      }),
    ]);
  });

  it("keeps the title a later untitled visit does not carry", () => {
    recordBrowserHistoryVisit(db, {
      scopeId: "thr_a",
      url: "https://example.test/",
      title: "Example",
      visitedAt: 1_000,
    });
    recordBrowserHistoryVisit(db, {
      scopeId: "thr_a",
      url: "https://example.test/",
      title: null,
      visitedAt: 2_000,
    });

    expect(listBrowserHistoryEntries(db, { limit: 10 })[0]?.title).toBe(
      "Example",
    );
  });

  it("keeps one row per scope for the same URL", () => {
    recordBrowserHistoryVisit(db, {
      scopeId: "thr_a",
      url: "https://example.test/",
      title: "Example",
      visitedAt: 1_000,
    });
    recordBrowserHistoryVisit(db, {
      scopeId: "browser-surface",
      url: "https://example.test/",
      title: "Example",
      visitedAt: 2_000,
    });

    expect(listBrowserHistoryEntries(db, { limit: 10 })).toHaveLength(2);
    expect(
      listBrowserHistoryEntries(db, { limit: 10, scopeId: "thr_a" }),
    ).toHaveLength(1);
  });

  it("matches a query against the URL and the title, case-insensitively", () => {
    recordBrowserHistoryVisit(db, {
      scopeId: "thr_a",
      url: "https://example.test/reference",
      title: "Справочник",
      visitedAt: 1_000,
    });
    recordBrowserHistoryVisit(db, {
      scopeId: "thr_a",
      url: "https://elsewhere.test/",
      title: "Elsewhere",
      visitedAt: 2_000,
    });

    expect(
      listBrowserHistoryEntries(db, { limit: 10, query: "REFERENCE" }),
    ).toHaveLength(1);
    // Cyrillic is the case SQLite's own lower() and LIKE get wrong, which is
    // why the stored search text is folded in JavaScript.
    expect(
      listBrowserHistoryEntries(db, { limit: 10, query: "СПРАВОЧНИК" }),
    ).toHaveLength(1);
    expect(listBrowserHistoryEntries(db, { limit: 10, query: "%" })).toEqual(
      [],
    );
  });

  it("truncates a title too long to store", () => {
    recordBrowserHistoryVisit(db, {
      scopeId: "thr_a",
      url: "https://example.test/",
      title: "t".repeat(BROWSER_HISTORY_TITLE_MAX_LENGTH + 10),
      visitedAt: 1_000,
    });

    expect(listBrowserHistoryEntries(db, { limit: 10 })[0]?.title).toHaveLength(
      BROWSER_HISTORY_TITLE_MAX_LENGTH,
    );
  });

  it("drops the oldest entries once the store is over its cap", () => {
    for (let index = 0; index < BROWSER_HISTORY_MAX_ENTRIES + 5; index += 1) {
      recordBrowserHistoryVisit(db, {
        scopeId: "thr_a",
        url: `https://example.test/${index}`,
        title: null,
        visitedAt: 1_000 + index,
      });
    }

    // Asked for more than the cap on purpose: a limit equal to it would return
    // a full page whether or not anything was pruned.
    const entries = listBrowserHistoryEntries(db, {
      limit: BROWSER_HISTORY_MAX_ENTRIES + 100,
    });
    expect(entries).toHaveLength(BROWSER_HISTORY_MAX_ENTRIES);
    expect(entries[0]?.url).toBe(
      `https://example.test/${BROWSER_HISTORY_MAX_ENTRIES + 4}`,
    );
    expect(entries[entries.length - 1]?.url).toBe("https://example.test/5");
  });

  it("deletes one entry and clears a single scope", () => {
    const kept = recordBrowserHistoryVisit(db, {
      scopeId: "browser-surface",
      url: "https://kept.test/",
      title: null,
      visitedAt: 1_000,
    });
    const removed = recordBrowserHistoryVisit(db, {
      scopeId: "thr_a",
      url: "https://removed.test/",
      title: null,
      visitedAt: 2_000,
    });
    recordBrowserHistoryVisit(db, {
      scopeId: "thr_a",
      url: "https://also-removed.test/",
      title: null,
      visitedAt: 3_000,
    });

    expect(deleteBrowserHistoryEntry(db, removed.id)).toBe(true);
    expect(deleteBrowserHistoryEntry(db, removed.id)).toBe(false);
    expect(clearBrowserHistory(db, { scopeId: "thr_a" })).toBe(1);
    expect(listBrowserHistoryEntries(db, { limit: 10 })).toEqual([
      expect.objectContaining({ id: kept.id }),
    ]);
  });
});
