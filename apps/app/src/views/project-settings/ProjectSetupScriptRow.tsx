import type { ProjectSetupScriptConsentResponse } from "@patcher/server-contract";
import { Button } from "@patcher/shared-ui/button";
import { Pill } from "@patcher/shared-ui/pill";
import { SettingsRow } from "@/components/ui/settings-section.js";

interface ProjectSetupScriptRowProps {
  consent: ProjectSetupScriptConsentResponse;
  /** The machine's name, or null while the machine list has not arrived. */
  machineName: string | null;
  isPending: boolean;
  onAllow: (consentId: string) => void;
  onForget: (consentId: string) => void;
}

/** `.../worktree/.patcher-env-setup.sh` → `.patcher-env-setup.sh`. */
function scriptFileName(scriptPath: string): string {
  const separator = Math.max(
    scriptPath.lastIndexOf("/"),
    scriptPath.lastIndexOf("\\"),
  );
  return separator === -1 ? scriptPath : scriptPath.slice(separator + 1);
}

/**
 * One remembered answer, or one question still waiting for one.
 *
 * The machine and the checkout lead, because that is the scope of the answer:
 * allowing here is not allowing the same script anywhere else. The hash is shown
 * short — enough to tell two scripts apart, and it is the file's content that is
 * being allowed rather than its name.
 */
export function ProjectSetupScriptRow({
  consent,
  machineName,
  isPending,
  onAllow,
  onForget,
}: ProjectSetupScriptRowProps) {
  const waiting = consent.status === "asked";
  return (
    <SettingsRow>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-1.5">
          {machineName === null ? null : (
            <span className="max-w-40 shrink-0 truncate font-medium">
              {machineName}
            </span>
          )}
          <span className="min-w-0 flex-shrink truncate">
            {consent.sourcePath}
          </span>
          {waiting ? <Pill variant="outline">Waiting for you</Pill> : null}
        </span>
        <span className="truncate text-xs text-subtle-foreground">
          {scriptFileName(consent.scriptPath)} — {consent.scriptByteLength}{" "}
          bytes, sha256 {consent.scriptSha256.slice(0, 12)}…
        </span>
      </span>
      {waiting ? (
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => onAllow(consent.id)}
        >
          Allow
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={isPending}
        onClick={() => onForget(consent.id)}
      >
        {waiting ? "Dismiss" : "Revoke"}
      </Button>
    </SettingsRow>
  );
}
