// patcher-plugin-bookmarks — the Phase 8 chrome surfaces, in the shape they were built
// for.
//
// Patcher has no bookmarks, deliberately: a plugin can own the whole feature, and
// building it in the core would have spent the demonstration this repo exists to
// make. What the core *did* have to provide was somewhere to put a control, since
// nothing else could — and that is the three surfaces this file uses:
//
//   * `patcher.browser.registerToolbarItem` — the star in the address bar, which has to
//     know whether *this* page is saved before anyone touches it;
//   * `patcher.browser.registerNewTabWidget` — the list, where a browser has nothing
//     else to show;
//   * `patcher.ui.registerCommand` — Cmd+D, a chord Patcher had never heard of.
//
// Plus two the browser already had: an omnibox provider, so a saved page is
// findable by typing, and the plugin's own SQLite, so the list survives a restart.
//
// See docs/architecture/browser-surface.md for the surfaces and docs/TODO.md for
// why this is an example rather than a feature.
import type { PatcherPluginApi } from "@patcher/plugin-sdk";

interface BookmarkRow {
  url: string;
  title: string | null;
  saved_at: number;
}

/**
 * Append-only, as `patcher.storage.migrate` requires: the statement's index *is* its
 * migration id, so an edit to a shipped line would be a migration that never
 * runs on an install that already has it.
 */
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS bookmarks (
     url TEXT PRIMARY KEY,
     title TEXT,
     saved_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS bookmarks_saved_at ON bookmarks (saved_at DESC)`,
];

/** How many rows the new-tab section shows. The host caps at 12 either way. */
const NEW_TAB_ROWS = 12;
const OMNIBOX_ROWS = 5;

/**
 * A page worth saving is one the browser can go back to.
 *
 * Patcher's own screens (`patcher:`), a `file:` path and a `data:` blob are all things the
 * chord can fire on, and none of them is a bookmark: the new-tab row would be
 * refused by the host anyway (rows are `http`/`https` links), so refusing here
 * keeps the store from holding what the list could never show.
 */
function isSaveable(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export default function plugin(patcher: PatcherPluginApi) {
  const db = patcher.storage.database();
  patcher.storage.migrate(db, MIGRATIONS);

  const findOne = db.prepare(`SELECT url FROM bookmarks WHERE url = ?`);
  // The conflict clause is not decoration: two presses in the same tick both read
  // "not saved" and both insert, and a plugin's callbacks are not serialized for
  // it. Updating the title keeps the row where it was in the list.
  const insert = db.prepare(
    `INSERT INTO bookmarks (url, title, saved_at) VALUES (?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET title = excluded.title`,
  );
  const remove = db.prepare(`DELETE FROM bookmarks WHERE url = ?`);
  const listNewest = db.prepare(
    // `rowid` breaks the tie: two pages saved in the same millisecond is ordinary
    // (a chord, then the star), and "newest first" has to mean something then too.
    `SELECT url, title, saved_at FROM bookmarks
       ORDER BY saved_at DESC, rowid DESC LIMIT ?`,
  );
  const search = db.prepare(
    `SELECT url, title, saved_at FROM bookmarks
       WHERE url LIKE ? ESCAPE '\\' OR IFNULL(title, '') LIKE ? ESCAPE '\\'
       ORDER BY saved_at DESC, rowid DESC LIMIT ?`,
  );

  const isSaved = (url: string): boolean => findOne.get(url) !== undefined;

  /**
   * One toggle behind every way to save a page, so the star, the chord and a
   * second press of either cannot disagree about what "saved" means.
   */
  const toggle = (url: string, title: string | null): boolean => {
    if (!isSaveable(url)) return false;
    if (isSaved(url)) {
      remove.run(url);
      return false;
    }
    // A blank title is stored as *no* title, on the way in: a row must carry a
    // non-empty one, and the host drops a widget's whole answer over a bad row —
    // so one untitled page would cost every other bookmark its place in the list.
    const trimmed = title?.trim() ?? "";
    insert.run(url, trimmed.length === 0 ? null : trimmed, Date.now());
    return true;
  };

  // The star. `state` is asked as the user navigates — which is the whole reason
  // the surface exists, because a star that only fills in after you press it is
  // not a star — and `run` is asked again once it resolves, so a toggle shows its
  // new look without this plugin doing anything else.
  patcher.browser.registerToolbarItem({
    id: "star",
    title: "Save this page",
    icon: "Star",
    state(context) {
      if (!isSaved(context.url)) {
        // Null keeps what was declared. Returning `{ active: false }` would look
        // the same and say less.
        return null;
      }
      return { active: true, title: "Remove from bookmarks" };
    },
    run(context) {
      toggle(context.url, context.title);
    },
  });

  // The list, on the screen a fresh tab shows. Rows are links the plugin resolved
  // here, so opening one costs no round trip back into this process.
  patcher.browser.registerNewTabWidget({
    id: "saved",
    label: "Bookmarks",
    rows() {
      const rows = listNewest.all(NEW_TAB_ROWS) as BookmarkRow[];
      if (rows.length === 0) {
        // No heading over an empty list: a new tab with nothing saved should look
        // exactly as it did before this plugin was installed.
        return null;
      }
      return rows.map((row) => ({
        title: row.title ?? row.url,
        // No subtitle on purpose — the screen shows the row's host when a plugin
        // gives none, which is what a list of places wants to say.
        url: row.url,
      }));
    },
  });

  // Cmd+D, the chord every browser uses for this. It is matched after every one of
  // Patcher's own bindings, so if Patcher ever takes Cmd+D this stops firing rather than
  // shadowing the browser — Settings → Keyboard says so outright.
  patcher.ui.registerCommand({
    id: "toggle",
    title: "Bookmark this page",
    shortcut: { key: "d", mod: true },
    async run() {
      // The command is handed no context, deliberately: it reads the page through
      // the call that is already gated for it (`tabs.read`) rather than having
      // every chord in the app carry the user's current address.
      let url: string;
      let title: string | null;
      try {
        url = await patcher.browser.page.getUrl();
        title = await patcher.browser.page.getTitle();
      } catch {
        // No browser tab to read — the chord fired on an agent screen, or the
        // desktop app is not running. Nothing to bookmark and nothing to report.
        return;
      }
      toggle(url, title);
    },
  });

  // Typing finds what was saved. A `navigate` action rather than a `run` one: the
  // row already knows where it goes, so picking it is navigation and this plugin
  // is never called back.
  patcher.browser.registerOmniboxProvider({
    id: "bookmarks",
    label: "Bookmarks",
    suggest(context) {
      const pattern = `%${context.query.replace(/[\\%_]/gu, "\\$&")}%`;
      const rows = search.all(pattern, pattern, OMNIBOX_ROWS) as BookmarkRow[];
      return rows.map((row) => ({
        id: row.url,
        title: row.title ?? row.url,
        subtitle: row.url,
        // Below the browser's own default action (score 1), which is what keeps
        // Enter doing what the user typed rather than what a plugin remembered.
        score: 0.6,
        action: { type: "navigate" as const, url: row.url },
      }));
    },
  });
}
