import { useAtomValue } from "jotai";
import { BROWSER_EXTERNAL_ACCESS_DESCRIPTIONS } from "@patcher/domain";
import type { BrowserCommandIssuer } from "@patcher/server-contract";
import { cn } from "@patcher/shared-ui/lib/utils";
import { Button } from "@patcher/shared-ui/button";
import { useSetBrowserAccessGrantPaused } from "@/hooks/mutations/settings-mutations";
import { browserDrivingAtom } from "@/lib/browser-agent/driving";

/**
 * "Something other than you is driving this browser", in the browser's own
 * chrome.
 *
 * The only place it can be said. Electron draws no banner over a
 * `WebContentsView`, the page cannot be decorated from inside, and a
 * `patcher browser` command is indistinguishable on screen from the user's own
 * click — a tab navigates, a form fills in, and nothing says who did it.
 *
 * **In the layout, not over the page.** A native view composites above the DOM,
 * so anything drawn over the page area would be invisible in the desktop app.
 * This is a row of the chrome, like the downloads panel. See
 * docs/architecture/browser-surface.md.
 *
 * **The button pauses rather than revokes.** It is pressed while an agent is
 * doing something the person did not want, and the thing they want back is the
 * browser, not an afternoon of reconfiguring the agent: a paused grant refuses
 * everything and stays a valid credential, so Settings can put it back with one
 * click. Revoking is still a click away in Settings, for the credential they
 * want gone.
 *
 * The other two issuers get no button, because neither has one honest thing to
 * press. A turn inside Patcher is stopped in the thread it belongs to. A caller
 * holding the app key cannot be told apart from any other holder of the app
 * key, so the only lever is the install-wide setting — which is what the button
 * opens instead of pretending to something narrower.
 */

export interface BrowserDrivingIndicatorProps {
  /** Go to one of Patcher's own screens; the surface performs the navigation. */
  onOpenAppRoute: (path: string) => void;
}

function issuerName(issuer: BrowserCommandIssuer): string {
  switch (issuer.kind) {
    case "grant":
      return issuer.label;
    case "thread":
      return "An agent in Patcher";
    case "outside":
      // Not "an agent": this is also what a person running `patcher browser`
      // in their own terminal produces, and the server cannot tell the two
      // apart — that is what the grant beside it exists to fix.
      return "Something outside Patcher";
  }
}

export function BrowserDrivingIndicator({
  onOpenAppRoute,
}: BrowserDrivingIndicatorProps) {
  const driving = useAtomValue(browserDrivingAtom);
  const pause = useSetBrowserAccessGrantPaused();

  if (driving === null) return null;
  const { issuer } = driving;

  return (
    <div
      // `status` rather than `alert`: it is worth announcing when it appears,
      // and it is not an error and must not interrupt what the user is doing.
      role="status"
      className="flex items-center gap-2 border-t border-border bg-warning/10 px-3 py-1.5 text-xs text-warning-text"
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-warning",
          driving.active && "animate-pulse",
        )}
      />
      <p className="min-w-0 flex-1 truncate">
        <span className="font-medium">{issuerName(issuer)}</span> is driving
        this browser
        {issuer.kind === "grant"
          ? ` · ${BROWSER_EXTERNAL_ACCESS_DESCRIPTIONS[issuer.level].label.toLowerCase()}`
          : ""}
      </p>
      {issuer.kind === "grant" ? (
        // Once it is paused the row is telling the truth about a moment that
        // has passed: the last command was this grant's, and it lingers a few
        // seconds. What must not linger is the button — an offer to do again
        // what was just done reads as "it did not work", and the next thing to
        // hand is Revoke.
        pause.isSuccess && pause.variables?.grantId === issuer.grantId ? (
          <span className="shrink-0 font-medium">Paused</span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={pause.isPending}
            onClick={() => {
              pause.mutate({ grantId: issuer.grantId, paused: true });
            }}
          >
            Pause
          </Button>
        )
      ) : issuer.kind === "outside" ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onOpenAppRoute("/settings");
          }}
        >
          Settings
        </Button>
      ) : null}
    </div>
  );
}
