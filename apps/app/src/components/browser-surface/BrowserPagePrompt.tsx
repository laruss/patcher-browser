import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  PatcherDesktopBrowserPagePromptAnswer,
  PatcherDesktopBrowserPagePromptDetails,
} from "@patcher/desktop-contract";
import { Icon } from "@patcher/shared-ui/icon";
import { cn } from "@patcher/shared-ui/lib/utils";

/**
 * The questions the network asks and only a human can answer: a site wanting a
 * username and password, a certificate that does not verify, a server asking
 * which client certificate to present.
 *
 * All three used to fail in silence — Electron's defaults cancel the first two
 * and pick a certificate by position for the third — so what this renders is
 * not a nicer version of something; it is the first time the user is asked at
 * all.
 *
 * It draws inside the panel over a bitmap of the stopped page, exactly as
 * `BrowserPageDialog` does and for the same reason: a `WebContentsView`
 * composites above the DOM, so the shell hides the view while one is open.
 */

export interface BrowserPagePromptProps {
  onRespond: (answer: PatcherDesktopBrowserPagePromptAnswer["answer"]) => void;
  prompt: PatcherDesktopBrowserPagePromptDetails;
}

const PROMPT_TITLES: Record<
  PatcherDesktopBrowserPagePromptDetails["kind"],
  string
> = {
  auth: "Sign in",
  certificate: "This connection is not private",
  "client-certificate": "Choose a certificate",
};

/** Unix seconds as a plain date; a certificate's dates are the whole point. */
function formatCertificateDate(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return "unknown";
  }
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

const PRIMARY_BUTTON_CLASS =
  "inline-flex h-8 items-center rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-state-hover";
const QUIET_BUTTON_CLASS =
  "inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground";
const FIELD_CLASS =
  "h-8 w-full rounded-md border border-border bg-surface-recessed px-2 text-sm text-foreground outline-none focus-visible:border-ring";

export function BrowserPagePrompt({
  onRespond,
  prompt,
}: BrowserPagePromptProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedCertificate, setSelectedCertificate] = useState(0);
  const usernameRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setUsername("");
    setPassword("");
    setSelectedCertificate(0);
    // Focus where the answer comes from. For the two prompts that are refusals
    // by default, that is Cancel: the safe answer should be the one a stray
    // Enter gives.
    if (prompt.kind === "auth") {
      usernameRef.current?.focus();
    } else {
      cancelRef.current?.focus();
    }
  }, [prompt]);

  const cancel = () => {
    onRespond({ kind: "cancel" });
  };

  const submitCredentials = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onRespond({ kind: "credentials", username, password });
  };

  return (
    <div
      className="absolute inset-0 flex items-start justify-center bg-black/40 p-6"
      // The page is stopped behind this; the backdrop is what makes that
      // legible. Escape cancels, which is the answer the browser would have
      // given on its own.
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={PROMPT_TITLES[prompt.kind]}
        className="mt-10 flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-background p-4 shadow-lg"
      >
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-recessed",
              prompt.kind === "certificate"
                ? "text-warning"
                : "text-muted-foreground",
            )}
          >
            <Icon
              name={prompt.kind === "auth" ? "Lock" : "AlertTriangle"}
              className="size-4"
              aria-hidden
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {PROMPT_TITLES[prompt.kind]}
            </p>
            {/* The host is the one thing a user can judge, so it is the one
                thing shown large. Everything else here was written by whoever
                answered at that address. */}
            <p className="mt-1 break-words font-mono text-sm text-muted-foreground">
              {prompt.host}
            </p>
          </div>
        </div>

        {prompt.kind === "auth" ? (
          <form onSubmit={submitCredentials} className="flex flex-col gap-2">
            {prompt.insecure ? (
              <p className="text-xs text-warning">
                This site is not using a secure connection. Your username and
                password would be sent in the clear.
              </p>
            ) : null}
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Username
              <input
                ref={usernameRef}
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                }}
                autoComplete="off"
                className={FIELD_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
                autoComplete="off"
                className={FIELD_CLASS}
              />
            </label>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                ref={cancelRef}
                type="button"
                onClick={cancel}
                className={QUIET_BUTTON_CLASS}
              >
                Cancel
              </button>
              <button type="submit" className={PRIMARY_BUTTON_CLASS}>
                Sign in
              </button>
            </div>
          </form>
        ) : null}

        {prompt.kind === "certificate" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              The certificate this site presented could not be verified, so
              there is no way to tell whether you are talking to the right
              server.
            </p>
            {/* Proceeding is behind a disclosure, as it is in every browser:
                the details are what make it an informed decision rather than a
                second button. */}
            <details className="rounded-md border border-border bg-surface-recessed p-2">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Advanced
              </summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px] text-subtle-foreground">
                <dt>Error</dt>
                <dd className="break-all">{prompt.errorCode}</dd>
                <dt>Issued to</dt>
                <dd className="break-all">{prompt.subjectName}</dd>
                <dt>Issued by</dt>
                <dd className="break-all">{prompt.issuerName}</dd>
                <dt>Valid</dt>
                <dd>
                  {formatCertificateDate(prompt.validFrom)} –{" "}
                  {formatCertificateDate(prompt.validTo)}
                </dd>
                <dt>Fingerprint</dt>
                <dd className="break-all">{prompt.fingerprint}</dd>
              </dl>
              <button
                type="button"
                onClick={() => {
                  onRespond({ kind: "proceed" });
                }}
                className={cn(QUIET_BUTTON_CLASS, "mt-2 text-warning")}
              >
                Proceed to {prompt.host} (unsafe)
              </button>
            </details>
            <div className="flex items-center justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={cancel}
                className={PRIMARY_BUTTON_CLASS}
              >
                Go back
              </button>
            </div>
          </div>
        ) : null}

        {prompt.kind === "client-certificate" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              This site asked for a certificate to identify you.
            </p>
            <div
              role="listbox"
              aria-label="Certificates"
              className="flex max-h-48 flex-col gap-1 overflow-y-auto"
            >
              {prompt.certificates.map((certificate) => {
                const isSelected = certificate.index === selectedCertificate;
                return (
                  <div
                    key={certificate.index}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      setSelectedCertificate(certificate.index);
                    }}
                    className={cn(
                      "cursor-pointer rounded-md border p-2 text-xs",
                      isSelected
                        ? "border-border bg-state-active text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-state-hover",
                    )}
                  >
                    <p className="break-words font-medium">
                      {certificate.subjectName}
                    </p>
                    <p className="break-words text-subtle-foreground">
                      {certificate.issuerName} · expires{" "}
                      {formatCertificateDate(certificate.validTo)}
                    </p>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={cancel}
                className={QUIET_BUTTON_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onRespond({
                    kind: "client-certificate",
                    index: selectedCertificate,
                  });
                }}
                className={PRIMARY_BUTTON_CLASS}
              >
                Select
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
