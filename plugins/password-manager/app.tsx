import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
  type PluginLeadingPanelProps,
} from "@patcher/plugin-sdk/app";
import type {
  FormHint,
  ManagerOperation,
  ManagerView,
  rpcContract,
} from "./contracts.js";
import { httpsOrigin } from "./origin.js";

const buttonClass = "rounded border px-2 py-1 text-xs disabled:opacity-50";
const messages = {
  saved: "Login saved.",
  updated: "Login updated.",
  filled: "Login filled. Submit the form yourself.",
  deleted: "Login deleted.",
  cancelled: "Request cancelled. Nothing will be retried.",
  denied: "Action refused. Check site access and unlock the desktop app.",
  unavailable: "The protected vault is unavailable on this host.",
  unsupported:
    "This form is unsupported. Use one visible login form with a same-origin action.",
  busy: "Another request is pending. Review or dismiss it first.",
} as const;

function ManagerForPage({ tabId, origin }: { tabId: string; origin: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [view, setView] = useState<ManagerView | null>(null);
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<FormHint | null>(null);
  const live = useRef(true);
  const loadVersion = useRef(0);
  const pending = useRef<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const result = await rpc.call("view", { tabId, origin });
      if (live.current && version === loadVersion.current) setView(result);
    } catch {
      if (live.current && version === loadVersion.current)
        setView({ status: "unavailable", accounts: [] });
    }
  }, [origin, rpc, tabId]);

  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
      loadVersion.current++;
      if (hintTimer.current !== undefined) clearTimeout(hintTimer.current);
      if (pending.current)
        void rpc.call("cancel", { requestId: pending.current }).catch(() => {});
    };
  }, [load, rpc]);
  useRealtime("refresh", (payload) => {
    const target = payload as { tabId?: unknown; origin?: unknown } | null;
    if (target?.tabId === tabId && target.origin === origin) void load();
  });
  useRealtime("form-hint", (payload) => {
    const value = payload as Partial<FormHint> | null;
    if (
      !value ||
      value.origin !== origin ||
      typeof value.present !== "boolean" ||
      (value.kind !== "form" && value.kind !== "submit")
    )
      return;
    // A page hint changes only advisory text, never accounts or proposals.
    setHint(value as FormHint);
    if (hintTimer.current !== undefined) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 30_000);
  });

  async function useHere() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/plugins/site-access/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pluginId: "password-manager", tabId }),
      });
      if (!response.ok) throw new Error("Refused");
      if (live.current) {
        setMessage(
          "Site allowed. Reload the page to enable form hints, or save manually.",
        );
        await load();
      }
    } catch {
      if (live.current) setMessage("Site access was refused or cancelled.");
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function request(
    operation:
      | Omit<
          Extract<ManagerOperation, { operation: "save" }>,
          "tabId" | "origin" | "requestId"
        >
      | Omit<
          Exclude<ManagerOperation, { operation: "save" }>,
          "tabId" | "origin" | "requestId"
        >,
  ) {
    if (pending.current) return;
    const requestId = crypto.randomUUID();
    pending.current = requestId;
    setBusy(true);
    setMessage(
      "Review this request above the page, then confirm in the native dialog.",
    );
    try {
      const result = await rpc.call("request", {
        ...operation,
        tabId,
        origin,
        requestId,
      });
      if (live.current) {
        setMessage(messages[result.status]);
        if (result.status === "saved") setLabel("");
        await load();
      }
    } catch {
      void rpc.call("cancel", { requestId }).catch(() => {});
      if (live.current) setMessage("Request failed. Nothing will be retried.");
    } finally {
      if (pending.current === requestId) pending.current = null;
      if (live.current) setBusy(false);
    }
  }
  const ready = view?.status === "ready";
  return (
    <section
      aria-label="Password manager"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 text-sm"
    >
      <h2 className="font-medium">Password manager</h2>
      <p className="break-all text-xs" title={origin}>
        {origin}
      </p>
      <p className="text-xs text-muted-foreground">
        Passwords stay in the protected vault. Every action needs your
        confirmation.
      </p>
      {!ready ? (
        <div className="space-y-2 text-xs">
          <p>
            {view === null
              ? "Checking access…"
              : view.status === "unavailable"
                ? "The connected desktop vault is unavailable."
                : "Allow this site and unlock the desktop app to manage logins."}
          </p>
          <button
            className={buttonClass}
            disabled={busy || view === null || view.status === "unavailable"}
            onClick={() => void useHere()}
            type="button"
          >
            Use here
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => void load()}
              type="button"
            >
              Refresh logins
            </button>
          </div>
          {hint?.present ? (
            <p className="text-xs text-muted-foreground">
              {hint.kind === "submit"
                ? "A login was submitted; success is unknown. Save or update manually while the form is still here."
                : "A possible login form is present. Save manually before leaving this page."}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            One visible password field, at most one username/email field. Other
            forms may be unsupported. Filled passwords are readable by the site.
          </p>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (label.trim())
                void request({ operation: "save", accountId: label.trim() });
            }}
          >
            <label className="flex flex-col gap-1 text-xs">
              New account label
              <input
                className="rounded border bg-transparent px-2 py-1"
                maxLength={128}
                onChange={(event) => setLabel(event.target.value)}
                value={label}
                disabled={busy}
                placeholder="Personal, work…"
              />
            </label>
            <button
              className={buttonClass}
              type="submit"
              disabled={busy || !label.trim()}
            >
              Save new login
            </button>
          </form>
          {view.accounts.length === 0 ? (
            <p className="text-xs">No saved logins for this origin.</p>
          ) : null}
          <ul className="space-y-3">
            {view.accounts.map((account) => (
              <li key={account.id} className="space-y-2 rounded border p-2">
                <p className="break-words font-medium">{account.accountId}</p>
                <p className="break-all text-xs">
                  {account.username || "No username"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {account.protection === "require-touch-id"
                    ? "Requires Touch ID for every action"
                    : "Confirm every action"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {(["fill", "update", "delete"] as const).map((action) => (
                    <button
                      key={action}
                      aria-label={`${action === "fill" ? "Fill" : action === "update" ? "Update" : "Delete"} ${account.accountId}`}
                      className={buttonClass}
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        void request({
                          operation: action,
                          reference: {
                            id: account.id,
                            version: account.version,
                          },
                        })
                      }
                    >
                      {action === "fill"
                        ? "Fill"
                        : action === "update"
                          ? "Update from form"
                          : "Delete"}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {message ? (
        <p role="status" className="text-xs">
          {message}
        </p>
      ) : null}
      {pending.current ? (
        <button
          type="button"
          className={buttonClass}
          onClick={() =>
            void rpc
              .call("cancel", { requestId: pending.current! })
              .catch(() => {})
          }
        >
          Cancel request
        </button>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Disable this plugin in Settings → Plugins to use another manager.
        Encrypted logins are kept.
      </p>
    </section>
  );
}

export function PasswordManagerPanel({
  browserUrl,
  browserTabId,
}: PluginLeadingPanelProps) {
  const origin = browserUrl ? httpsOrigin(browserUrl) : null;
  if (!origin || !browserTabId)
    return (
      <p className="p-3 text-xs">
        Open an HTTPS login page in a current desktop host.
      </p>
    );
  // Remount even within the same origin: discard hints, drafts and old replies.
  return (
    <ManagerForPage
      key={`${browserTabId}\n${browserUrl}`}
      tabId={browserTabId}
      origin={origin}
    />
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_leadingPanel({
    id: "logins",
    title: "Password manager",
    icon: "Key",
    matches: ["https://**"],
    component: PasswordManagerPanel,
  });
});
