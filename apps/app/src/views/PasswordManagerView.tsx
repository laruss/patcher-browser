import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@patcher/shared-ui/dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@patcher/shared-ui/icon";
import type {
  PasswordEntry,
  PasswordManagerResponse,
} from "@patcher/desktop-contract";
import { getPatcherDesktopInfo } from "@/lib/patcher-desktop";
import "./password-manager.css";

type Editor = {
  origin: string;
  username: string;
  password: string;
  editToken?: string;
};
const messages: Partial<Record<PasswordManagerResponse["status"], string>> = {
  unavailable: "Password Manager is unavailable. Try again.",
  conflict: "This password has changed. Open it again to continue.",
  duplicate: "A password for this website and username already exists.",
  invalid: "Enter a valid website and a password.",
};
function siteName(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

export function PasswordManagerView() {
  const manager = getPatcherDesktopInfo()?.passwordManager;
  const [entries, setEntries] = useState<PasswordEntry[]>([]);
  const [status, setStatus] = useState("loading");
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedOrigin, setSelectedOrigin] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [visible, setVisible] = useState<{
    id: string;
    password: string;
  } | null>(null);
  const [showDraft, setShowDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sensitiveRevision = useRef(0);
  const focused = useRef(document.hasFocus());
  const invalidateSensitive = useCallback(() => {
    sensitiveRevision.current++;
    setVisible(null);
  }, []);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const refresh = useCallback(async () => {
    if (!manager) {
      setStatus("unavailable");
      return;
    }
    const result = await manager.request({ operation: "list" });
    setStatus(result.status);
    if (result.status === "ready") {
      setEntries(result.entries);
      setMigrationNeeded(result.migrationNeeded);
    } else {
      setEntries([]);
      setVisible(null);
      setEditor(null);
    }
  }, [manager]);
  useEffect(() => {
    document.title = "Password Manager";
    void refresh();
    return manager?.onChange(() => {
      invalidateSensitive();
      void refresh();
    });
  }, [manager, refresh, invalidateSensitive]);
  useEffect(() => {
    const hide = () => {
      setVisible(null);
      setShowDraft(false);
      const token = editorRef.current?.editToken;
      if (token) {
        void manager?.request({ operation: "cancel-edit", editToken: token });
        setEditor(null);
      }
    };
    const blur = () => {
      focused.current = false;
      hide();
    };
    const focus = () => {
      focused.current = true;
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        invalidateSensitive();
        focused.current = false;
        hide();
      } else focused.current = document.hasFocus();
    };
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      invalidateSensitive();
      hide();
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [manager, invalidateSensitive]);
  useEffect(() => {
    if (!visible) return;
    const timeout = window.setTimeout(() => setVisible(null), 30_000);
    return () => window.clearTimeout(timeout);
  }, [visible]);
  async function run(action: () => Promise<PasswordManagerResponse>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await action();
      if (messages[result.status]) setError(messages[result.status]!);
      if (result.status === "done") await refresh();
      return result;
    } finally {
      setBusy(false);
    }
  }
  async function operate(
    entry: PasswordEntry,
    operation: "reveal" | "edit" | "delete",
  ) {
    if (!manager) return;
    setVisible(null);
    const revision = sensitiveRevision.current;
    const result = await run(() =>
      manager.request({ operation, id: entry.id, version: entry.version }),
    );
    if (
      sensitiveRevision.current !== revision ||
      !focused.current ||
      !document.hasFocus() ||
      document.visibilityState === "hidden"
    ) {
      if (result?.status === "editing")
        void manager.request({
          operation: "cancel-edit",
          editToken: result.editToken,
        });
      return;
    }
    if (result?.status === "revealed")
      setVisible({ id: entry.id, password: result.password });
    if (result?.status === "editing") {
      setShowDraft(false);
      setEditor({
        origin: entry.origin,
        username: entry.username,
        password: result.password,
        editToken: result.editToken,
      });
    }
  }
  function closeEditor() {
    if (editor?.editToken)
      void manager?.request({
        operation: "cancel-edit",
        editToken: editor.editToken,
      });
    setEditor(null);
    setShowDraft(false);
    setError("");
  }
  async function saveEditor() {
    if (!editor || !manager) return;
    const draft = editor;
    const result = await run(() =>
      manager.request(
        draft.editToken
          ? { operation: "update", ...draft, editToken: draft.editToken }
          : {
              operation: "add",
              origin: draft.origin,
              username: draft.username,
              password: draft.password,
            },
      ),
    );
    if (result?.status === "done") {
      setEditor(null);
      setShowDraft(false);
    }
    if (result?.status === "cancelled")
      setError("The edit was not saved. Confirm again to continue.");
  }
  const search = query.trim().toLocaleLowerCase();
  const filtered = entries.filter((entry) =>
    `${siteName(entry.origin)} ${entry.origin} ${entry.username}`
      .toLocaleLowerCase()
      .includes(search),
  );
  const origins = [...new Set(filtered.map((entry) => entry.origin))].sort(
    (a, b) => siteName(a).localeCompare(siteName(b)),
  );
  const selected = entries.filter((entry) => entry.origin === selectedOrigin);
  return (
    <section className="password-manager" aria-label="Password Manager">
      <header className="password-manager-header">
        <h1>
          <span className="password-manager-logo">
            <Icon name="Key" className="size-6" />
          </span>
          Password Manager
        </h1>
        <label className="password-manager-search">
          <Icon name="Search" className="size-5" />
          <input
            aria-label="Search passwords"
            placeholder="Search passwords"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedOrigin(null);
              invalidateSensitive();
            }}
          />
        </label>
      </header>
      <main className="password-manager-content">
        {status === "loading" ? (
          <p role="status">Loading passwords…</p>
        ) : status !== "ready" ? (
          <div className="password-manager-empty">
            <Icon name="Key" className="size-6" />
            <h2>
              {status === "disabled"
                ? "Password Manager is turned off"
                : "Password Manager is unavailable"}
            </h2>
            <p>
              {status === "disabled"
                ? "Turn on the Password manager plugin to use your saved passwords."
                : "Open this page in the current Patcher desktop app."}
            </p>
            {status === "disabled" && (
              <Link to="/tools/plugins">Open Extensions</Link>
            )}
          </div>
        ) : (
          <>
            {migrationNeeded && (
              <div className="password-manager-migration">
                <div>
                  <strong>Enable automatic filling</strong>
                  <p>
                    Keep all your saved passwords and confirm once with Touch ID
                    or your macOS password to use them with automatic filling.
                  </p>
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() => manager!.request({ operation: "migrate" }))
                  }
                >
                  Continue
                </button>
              </div>
            )}
            <div className="password-manager-heading">
              {selectedOrigin && selected.length ? (
                <h2>
                  <button
                    className="password-manager-back"
                    aria-label="Back to passwords"
                    onClick={() => {
                      setSelectedOrigin(null);
                      invalidateSensitive();
                    }}
                  >
                    <Icon name="ArrowRight" className="size-5 rotate-180" />
                  </button>
                  {siteName(selectedOrigin)}
                </h2>
              ) : (
                <h2>Passwords</h2>
              )}
              <button
                className="password-manager-primary"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setShowDraft(false);
                  setEditor({ origin: "", username: "", password: "" });
                }}
              >
                Add password
              </button>
            </div>
            {error && !editor && (
              <p role="alert" className="password-manager-error">
                {error}
              </p>
            )}
            {selectedOrigin && selected.length ? (
              <div className="password-manager-details">
                {selected.map((entry) => (
                  <article className="password-manager-card" key={entry.id}>
                    <dl>
                      <div>
                        <dt>Website</dt>
                        <dd>{entry.origin}</dd>
                      </div>
                      <div>
                        <dt>Username</dt>
                        <dd>{entry.username || "No username"}</dd>
                      </div>
                      <div>
                        <dt>Password</dt>
                        <dd className="password-manager-secret">
                          <input
                            aria-label={`Password for ${entry.username || entry.origin}`}
                            readOnly
                            type={
                              visible?.id === entry.id ? "text" : "password"
                            }
                            value={
                              visible?.id === entry.id
                                ? visible.password
                                : "••••••••"
                            }
                            autoComplete="off"
                          />
                          <button
                            disabled={busy}
                            aria-label={
                              visible?.id === entry.id
                                ? "Hide password"
                                : "Show password"
                            }
                            onClick={() =>
                              visible?.id === entry.id
                                ? setVisible(null)
                                : void operate(entry, "reveal")
                            }
                          >
                            <Icon
                              name={visible?.id === entry.id ? "EyeOff" : "Eye"}
                              className="size-5"
                            />
                          </button>
                        </dd>
                      </div>
                    </dl>
                    <div className="password-manager-actions">
                      <button
                        disabled={busy}
                        onClick={() => void operate(entry, "edit")}
                      >
                        Edit
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void operate(entry, "delete")}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : origins.length ? (
              <div className="password-manager-list">
                {origins.map((origin) => (
                  <button
                    className="password-manager-row"
                    key={origin}
                    onClick={() => {
                      setSelectedOrigin(origin);
                      invalidateSensitive();
                    }}
                  >
                    <span className="password-manager-site-icon">
                      {siteName(origin).charAt(0).toUpperCase()}
                    </span>
                    <span>
                      <strong>{siteName(origin)}</strong>
                      <small>
                        {filtered
                          .filter((entry) => entry.origin === origin)
                          .map((entry) => entry.username || "No username")
                          .join(", ")}
                      </small>
                    </span>
                    <Icon name="ChevronRight" className="size-5" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="password-manager-empty">
                <Icon name="Key" className="size-6" />
                <h3>
                  {search
                    ? "No matching passwords"
                    : "Your saved passwords appear here"}
                </h3>
                <p>
                  {search
                    ? "Try another website or username."
                    : "Patcher offers to save passwords when you sign in. You can also add one yourself."}
                </p>
              </div>
            )}
          </>
        )}
      </main>
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open && !busy) closeEditor();
        }}
      >
        {editor && (
          <DialogContent className="password-manager password-manager-dialog">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveEditor();
              }}
            >
              <DialogTitle>
                {editor.editToken ? "Edit password" : "Add password"}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Website, username and password
              </DialogDescription>
              <label>
                Website
                <input
                  autoFocus
                  required
                  autoComplete="off"
                  placeholder="example.com"
                  value={editor.origin}
                  onChange={(event) =>
                    setEditor({ ...editor, origin: event.target.value })
                  }
                />
              </label>
              <label>
                Username
                <input
                  autoComplete="off"
                  value={editor.username}
                  onChange={(event) =>
                    setEditor({ ...editor, username: event.target.value })
                  }
                />
              </label>
              <label>
                Password
                <span className="password-manager-secret">
                  <input
                    required
                    autoComplete="off"
                    type={showDraft ? "text" : "password"}
                    value={editor.password}
                    onChange={(event) =>
                      setEditor({ ...editor, password: event.target.value })
                    }
                  />
                  <button
                    type="button"
                    aria-label={showDraft ? "Hide password" : "Show password"}
                    onClick={() => setShowDraft(!showDraft)}
                  >
                    <Icon
                      name={showDraft ? "EyeOff" : "Eye"}
                      className="size-5"
                    />
                  </button>
                </span>
              </label>
              {error && (
                <p role="alert" className="password-manager-error">
                  {error}
                </p>
              )}
              <div className="password-manager-actions">
                <button type="button" disabled={busy} onClick={closeEditor}>
                  Cancel
                </button>
                <button
                  className="password-manager-primary"
                  type="submit"
                  disabled={busy}
                >
                  Save
                </button>
              </div>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
