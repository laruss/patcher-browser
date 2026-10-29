import { useEffect, useState } from "react";
import {
  credentialPendingSchema,
  type CredentialPending,
  type PatcherDesktopBrowserApi,
} from "@patcher/desktop-contract";
import { z } from "zod";

/** Core chrome owns approval. Plugin renderers receive neither this capability nor secrets. */
export function BrowserCredentialRequests({
  tabId,
  browser,
}: {
  tabId: string;
  browser: PatcherDesktopBrowserApi;
}) {
  const [requests, setRequests] = useState<CredentialPending[]>([]);
  useEffect(() => {
    if (
      !browser.getCredentialRequests ||
      !browser.onCredentialRequestsChanged ||
      !browser.reviewCredentialRequest ||
      !browser.dismissCredentialRequest
    )
      return;
    let active = true;
    const load = () => {
      void browser.getCredentialRequests!()
        .then((value) => {
          const parsed = z.array(credentialPendingSchema).safeParse(value);
          if (active) setRequests(parsed.success ? parsed.data : []);
        })
        .catch(() => {
          if (active) setRequests([]);
        });
    };
    const unsubscribe = browser.onCredentialRequestsChanged(load);
    load();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [browser]);
  return requests
    .filter((request) => request.tabId === tabId)
    .map((request) => (
      <div
        key={request.id}
        className="flex shrink-0 items-center gap-2 border-b bg-background px-3 py-2 text-xs"
        role="status"
      >
        <span className="min-w-0 flex-1 break-all">
          {request.pluginName} requests {request.operation} for{" "}
          {request.accountId} on {request.origin}.{" "}
          {request.protection === "require-touch-id"
            ? "Touch ID required."
            : "Confirmation required."}
        </span>
        <button
          type="button"
          className="rounded border px-2 py-1"
          disabled={request.reviewing}
          onClick={() => {
            void browser.reviewCredentialRequest?.(request.id).catch(() => {});
          }}
        >
          Review
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1"
          onClick={() => {
            void browser.dismissCredentialRequest?.(request.id).catch(() => {});
          }}
        >
          Dismiss
        </button>
      </div>
    ));
}
