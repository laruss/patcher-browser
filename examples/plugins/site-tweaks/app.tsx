// The half a userscript cannot do: a panel that is part of the browser's own
// chrome, and that comes and goes with the site.
//
// `matches` is what makes it come and go. Without it the column would be there
// whenever this plugin is installed, and a component returning `null` for every
// non-GitHub page would leave an empty resizable edge behind — on macOS, one that
// owns the traffic lights. So the *host* removes the column instead, and this
// component can assume it is only ever mounted on a matching page.
//
// It costs no permission, unlike the page style in server.ts: this is Patcher reacting
// to its own address bar, not code reaching into a page.
import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useRealtime, useRpc } from "@patcher/plugin-sdk/app";
import type { rpcContract } from "./server";
import { repoFromUrl } from "./server";

interface Note {
  id: number;
  body: string;
  createdAt: number;
}

function RepoNotes({ browserUrl }: { browserUrl: string | null }) {
  const rpc = useRpc<typeof rpcContract>();
  // Derived from the URL rather than held: `browserUrl` changes as the user moves
  // between repositories, including on GitHub's own client-side navigations, and
  // the notes shown have to follow it.
  const repo = browserUrl === null ? null : repoFromUrl(browserUrl);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  // Bumped by the signal below, and nothing else reads it: the effect's real
  // dependency is "something changed on the server", which has no value of its own.
  const [reloads, setReloads] = useState(0);

  // The other end of `patcher.realtime.publish` in server.ts. This is what makes the
  // in-page button and this panel one feature rather than two: the click happens
  // in GitHub's own page, and the note appears here without either side knowing
  // about the other.
  useRealtime("notes", () => {
    setReloads((count) => count + 1);
  });

  useEffect(() => {
    if (repo === null) {
      setNotes([]);
      return;
    }
    let live = true;
    void rpc
      .call("notes", { repo })
      .then((result) => {
        // The tab can move between asking and being answered, and the answer
        // describes the repository we asked about, not the one on screen now.
        if (live) setNotes(result.notes);
      })
      .catch(() => {
        if (live) setNotes([]);
      });
    return () => {
      live = false;
    };
  }, [reloads, repo, rpc]);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (repo === null || draft.trim().length === 0) return;
      const result = await rpc.call("addNote", { repo, body: draft });
      setNotes(result.notes);
      setDraft("");
    },
    [draft, repo, rpc],
  );

  if (repo === null) {
    // On github.com but not inside a repository — the dashboard, settings. The
    // panel is here because the *site* matches; having nothing to say about this
    // particular page is ordinary.
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Open a repository to keep notes on it.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <p className="text-xs font-medium">{repo}</p>
      <form onSubmit={submit} className="flex gap-1">
        <input
          aria-label={`Add a note about ${repo}`}
          className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Note…"
          value={draft}
        />
        <button className="rounded border px-2 text-xs" type="submit">
          Add
        </button>
      </form>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {notes.map((note) => (
          <li className="flex items-start gap-1 text-xs" key={note.id}>
            <span className="min-w-0 flex-1 break-words">{note.body}</span>
            <button
              aria-label="Delete note"
              onClick={() =>
                void rpc
                  .call("deleteNote", { repo, id: note.id })
                  .then((result) => setNotes(result.notes))
              }
              type="button"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_leadingPanel({
    id: "repo-notes",
    title: "Repo notes",
    icon: "StickyNote",
    component: RepoNotes,
    // The same site the page style is declared for. Unlike `matches` there, this
    // one is not checked against `patcher.sites` — it decides whether Patcher draws its own
    // column, not what this plugin may reach.
    matches: ["https://github.com/**"],
  });
});
