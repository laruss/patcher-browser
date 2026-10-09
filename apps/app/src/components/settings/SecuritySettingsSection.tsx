import { useEffect, useState } from "react";
import type { DesktopSecretStorageStatus } from "@patcher/desktop-contract";
import { Button } from "@patcher/shared-ui/button";
import { SettingsSection } from "@/components/ui/settings-section";

const errors: Record<
  NonNullable<DesktopSecretStorageStatus["error"]>,
  string
> = {
  unavailable:
    "Secret storage requires a local server started by this desktop app.",
  locked:
    "The Keychain is locked or access was denied. Unlock it and try again.",
  corrupt:
    "Secret storage could not be verified. Restore a backup with its original Keychain key.",
  unsupported_version:
    "This app cannot read the secret storage version. Update the app.",
  conflict:
    "Old plaintext files conflict with encrypted storage. Resolve them before continuing.",
  invalid_request: "Secret storage refused the request.",
  cancelled:
    "Encryption was cancelled. Any completed migration steps are preserved.",
};
export function SecuritySettingsSection() {
  const api = window.patcherDesktop?.secretStorage;
  const [status, setStatus] = useState<DesktopSecretStorageStatus>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const canRetry = status?.error === "locked" || status?.error === "cancelled";
  useEffect(() => {
    if (api === undefined) return;
    let live = true;
    const refresh = () => {
      void api
        .status()
        .then((value) => {
          if (live) {
            setStatus(value);
            setFailed(false);
          }
        })
        .catch(() => {
          if (live) setFailed(true);
        });
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api]);
  async function run(action: "activate" | "unlock") {
    if (api === undefined || busy) return;
    setBusy(true);
    try {
      setStatus(await api[action]());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsSection
      title="Plugin secret storage"
      description="Protect ordinary plugin tokens on this Mac. Browser passwords are handled separately."
    >
      <div className="space-y-3 px-4 py-3 text-sm">
        {api === undefined ? (
          <p>
            Encryption is available in the macOS desktop app when it starts the
            local server.
          </p>
        ) : (
          <>
            <p>
              {status?.error === "unavailable"
                ? "Storage status unavailable."
                : status === undefined
                  ? "Checking storage…"
                  : status.mode === "encrypted"
                    ? "Encrypted with this Mac’s Keychain."
                    : "Plugin secret settings are stored as plaintext."}
            </p>
            {failed && (
              <p role="alert">Could not check secret storage. Try again.</p>
            )}
            {status?.error && <p role="alert">{errors[status.error]}</p>}
            {status?.migrationPending && (
              <p>
                Migration needs attention
                {status.unprocessedEntries > 0
                  ? `: ${status.unprocessedEntries} unrecognized entries were preserved`
                  : ""}
                .
              </p>
            )}
            <p className="text-muted-foreground">
              Encrypted secrets require the desktop app and the original
              Keychain key. Headless access and downgrades are unsupported.
              Existing backups may contain plaintext; encrypted files alone
              cannot restore credentials.
            </p>
            {status &&
              (status.mode === "plaintext" ||
                status.migrationPending ||
                status.error !== null) && (
                <Button
                  variant="outline"
                  disabled={busy || (!status.available && !canRetry)}
                  onClick={() => {
                    void run(canRetry ? "unlock" : "activate");
                  }}
                >
                  {busy
                    ? "Working…"
                    : canRetry
                      ? "Unlock and retry"
                      : status.mode === "plaintext"
                        ? "Encrypt plugin secrets"
                        : "Resume migration"}
                </Button>
              )}
          </>
        )}
      </div>
    </SettingsSection>
  );
}
