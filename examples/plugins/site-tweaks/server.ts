// patcher-plugin-site-tweaks — changing a site, and putting a panel beside it.
//
// The two halves of "replace a Chrome extension", in the shape they were built
// for:
//
//   * `patcher.browser.registerPageStyle` — CSS in GitHub's own pages, which is what
//     "remove or alter parts of a website" costs once the browser will carry it;
//   * `patcher.browser.registerPageScript` — a control *in* the page that calls this
//     plugin's own backend, which is the part a userscript cannot do: a page has
//     no database and no credentials of its own;
//   * a leading panel scoped with `matches` (see app.tsx) — the part a userscript
//     cannot do at all either, because it is Patcher's own chrome rather than injected
//     DOM.
//
// Put together, that is the whole loop: a button on github.com writes a row in this
// plugin's SQLite, and the browser's own panel shows it appear.
//
// The permission model is the thing worth reading here. `pageStyle.register` says
// this plugin restyles pages, `pageScript.register` says it runs code in them, and
// `patcher.sites` in package.json says *which* pages — for both. Every `matches` below
// must be one of those patterns verbatim. Widening the reach means editing the
// manifest, which is the line whoever installs this actually reads.
//
// See docs/architecture/plugin-permissions.md for why that split exists and
// docs/architecture/browser-surface.md for what the browser promises about applying
// the css (short version: one document, main frame, after commit).
import { defineRpcContract, type PatcherPluginApi } from "@patcher/plugin-sdk";
import { z } from "zod";

/** The one site this plugin declares, spelled once. Must match `patcher.sites`. */
const GITHUB = "https://github.com/**";

/**
 * Append-only, as `patcher.storage.migrate` requires: a statement's index *is* its
 * migration id, so editing a shipped line would be a migration that never runs
 * where it already ran.
 */
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS notes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     repo TEXT NOT NULL,
     body TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS notes_repo ON notes (repo, created_at DESC)`,
];

const NOTES_PER_REPO = 50;

/**
 * GitHub paths whose first segment is the site's own, not an owner's.
 *
 * Not exhaustive, and it does not need to be: guessing wrong costs the panel a
 * heading, not correctness. What it buys is that `/settings` and `/notifications`
 * do not each become a "repository" with its own notes.
 */
const RESERVED_OWNERS = new Set([
  "about",
  "codespaces",
  "explore",
  "issues",
  "marketplace",
  "new",
  "notifications",
  "orgs",
  "pricing",
  "pulls",
  "search",
  "settings",
  "sponsors",
  "topics",
  "trending",
]);

/**
 * `owner/repo` for a GitHub URL, or null when the page is not inside one.
 *
 * Exported because it is the only real logic in this file and the panel's whole
 * behaviour follows from it: this is what turns "the tab moved" into "show a
 * different set of notes".
 */
export function repoFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    return null;
  }
  const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
  if (owner === undefined || repo === undefined) return null;
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
  // A trailing `.git` is the clone URL's, not the page's.
  return `${owner}/${repo.replace(/\.git$/u, "")}`;
}

const noteSchema = z.object({
  id: z.number(),
  body: z.string(),
  createdAt: z.number(),
});

export const rpcContract = defineRpcContract({
  notes: {
    input: z.object({ repo: z.string().min(1) }),
    output: z.object({ notes: z.array(noteSchema) }),
  },
  addNote: {
    input: z.object({ repo: z.string().min(1), body: z.string().min(1) }),
    output: z.object({ notes: z.array(noteSchema) }),
  },
  deleteNote: {
    input: z.object({ repo: z.string().min(1), id: z.number() }),
    output: z.object({ notes: z.array(noteSchema) }),
  },
  /**
   * What the in-page button calls.
   *
   * It sends the address rather than a repository, so the answer to "what counts
   * as a repository" stays in one place — `repoFromUrl` below — instead of being
   * restated in a string of JavaScript that ships to a page. The url is a label,
   * not an authorisation: the browser already decided this plugin may run on this
   * site before the script existed.
   */
  notePage: {
    input: z.object({ url: z.string().min(1), body: z.string().min(1) }),
    output: z.object({ repo: z.string().nullable() }),
  },
});

interface NoteRow {
  id: number;
  body: string;
  created_at: number;
}

export default function plugin(patcher: PatcherPluginApi) {
  const db = patcher.storage.database();
  patcher.storage.migrate(db, MIGRATIONS);

  const insert = db.prepare(
    `INSERT INTO notes (repo, body, created_at) VALUES (?, ?, ?)`,
  );
  const remove = db.prepare(`DELETE FROM notes WHERE id = ? AND repo = ?`);
  const listForRepo = db.prepare(
    // `id` breaks the tie: two notes in the same millisecond is ordinary when one
    // is pasted after the other, and "newest first" has to mean something then.
    `SELECT id, body, created_at FROM notes
       WHERE repo = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
  );

  const notesFor = (repo: string) => ({
    notes: (listForRepo.all(repo, NOTES_PER_REPO) as NoteRow[]).map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
    })),
  });

  // The declutter. Data only — nothing is asked of this plugin as the user
  // browses, so the rules keep applying while it sits idle, and the shell
  // re-applies them on every navigation because inserted css lives one document.
  //
  // `!important` is not defensiveness: GitHub's own stylesheet was there first,
  // and this is a late stylesheet like any other.
  patcher.browser.registerPageStyle({
    id: "declutter",
    matches: [GITHUB],
    css: `
      /* The "you have unread notifications" shelf above the header. */
      .js-notification-shelf { display: none !important }
      /* The dashboard's activity feed, which is the whole reason people bounce
         off github.com when they meant to open one repository. */
      .js-dashboard-feed-container { display: none !important }
      /* Read code in the width the window actually has. */
      .container-xl { max-width: none !important }
    `,
  });

  // The in-page half. `patcher` inside this string is `PluginPageScriptApi` — two
  // members, `rpc` and `ready` — and the code runs in an isolated world of this
  // plugin's own, before GitHub's own scripts do.
  //
  // Two things every page script has to get right, and both are here:
  //
  //   * `patcher.ready`, because at the moment this runs the page has no elements yet;
  //   * re-mounting, because GitHub replaces the page's content on its own
  //     navigations and takes anything added to it along. The browser re-runs a
  //     page script per *document*, and a client-side route change is not one.
  patcher.browser.registerPageScript({
    id: "note-button",
    matches: [GITHUB],
    code: `
      function mount() {
        if (document.getElementById("patcher-note-page")) return;
        const button = document.createElement("button");
        button.id = "patcher-note-page";
        button.textContent = "Note this page";
        button.style.cssText =
          "position:fixed;right:16px;bottom:16px;z-index:9999;padding:6px 10px;" +
          "border-radius:6px;border:1px solid #444;background:#1f2328;color:#fff;" +
          "font:12px system-ui;cursor:pointer";
        button.addEventListener("click", function () {
          button.disabled = true;
          patcher.rpc("notePage", { url: location.href, body: document.title })
            .then(function (answer) {
              button.textContent = answer.repo === null ? "Not a repository" : "Noted";
            })
            .catch(function (error) {
              button.textContent = error.message;
            })
            .then(function () {
              setTimeout(function () {
                button.textContent = "Note this page";
                button.disabled = false;
              }, 1500);
            });
        });
        document.body.append(button);
      }

      patcher.ready(function () {
        mount();
        new MutationObserver(mount).observe(document.body, { childList: true });
      });
    `,
  });

  patcher.rpc.register(rpcContract, {
    notes: ({ repo }) => notesFor(repo),
    addNote: ({ repo, body }) => {
      const trimmed = body.trim();
      if (trimmed.length > 0) {
        insert.run(repo, trimmed, Date.now());
      }
      return notesFor(repo);
    },
    deleteNote: ({ repo, id }) => {
      // Scoped to the repo as well as the id: the panel only ever shows one
      // repo's notes, so a delete that could reach another repo's row would be a
      // capability the UI never offers.
      remove.run(id, repo);
      return notesFor(repo);
    },
    notePage: ({ url, body }) => {
      const repo = repoFromUrl(url);
      if (repo === null) {
        // The page script runs on all of github.com, and most of it is not a
        // repository. Saying so is the answer, not an error.
        return { repo: null };
      }
      insert.run(repo, body.trim(), Date.now());
      // What makes the demo a loop rather than two features: the panel is
      // listening, so the note appears in the browser's own chrome as the click
      // lands in the page.
      patcher.realtime.publish("notes", { repo });
      return { repo };
    },
  });
}
