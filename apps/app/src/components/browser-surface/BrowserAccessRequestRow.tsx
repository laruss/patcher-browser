import { useEffect, useState } from "react";
import { BROWSER_EXTERNAL_ACCESS_DESCRIPTIONS } from "@patcher/domain";
import type {
  SystemBrowserAccessRequest,
  SystemBrowserAccessRequestDecideRequest,
} from "@patcher/server-contract";
import { Button } from "@patcher/shared-ui/button";
import { useDecideBrowserAccessRequest } from "@/hooks/mutations/settings-mutations";
import { useBrowserAccessRequests } from "@/hooks/queries/system-queries";

/**
 * A program outside Patcher asking the person for browser access, in the
 * window rather than through their terminal (#135).
 *
 * **"Calls itself".** The label is whatever the asker typed, and nothing on
 * this machine can check it — so the row says so, and shows the reason as the
 * asker's own words rather than as Patcher's. **Read pages only** is there
 * because the honest answer is often "less than that".
 *
 * **Its buttons wake up a moment after it appears.** A row arriving in the
 * chrome moves what is under the pointer, and a request that lands while the
 * person is clicking something else there — or the next one, replacing the one
 * they just answered — must not be answered by that click. The oldest request
 * is shown and newer ones wait behind it, so the row changes only when one is
 * answered or expires.
 */

const ARM_DELAY_MS = 600;

export interface BrowserAccessRequestRowProps {
  request: SystemBrowserAccessRequest;
  /** How many more are waiting behind this one. */
  waitingBehind?: number;
  disabled: boolean;
  onDecide: (answer: SystemBrowserAccessRequestDecideRequest) => void;
}

export function BrowserAccessRequestRow({
  request,
  waitingBehind = 0,
  disabled,
  onDecide,
}: BrowserAccessRequestRowProps) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  // Optional, as everywhere a level from the server is read: a server newer
  // than this window can name a level it cannot describe (#128).
  const described = BROWSER_EXTERNAL_ACCESS_DESCRIPTIONS[request.level] as
    | { label: string; detail: string }
    | undefined;
  const buttonsDisabled = disabled || !armed;

  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-2 border-t border-border bg-accent/10 px-3 py-1.5 text-xs"
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <p>
          A program on this machine that calls itself{" "}
          <span className="font-medium">&ldquo;{request.label}&rdquo;</span>{" "}
          asks for browser access:{" "}
          <span className="font-medium">
            {described?.label ?? request.level}
          </span>
          {waitingBehind > 0 ? (
            <span className="opacity-80"> · {waitingBehind} more waiting</span>
          ) : null}
        </p>
        {described === undefined ? null : (
          <p className="text-subtle-foreground">{described.detail}</p>
        )}
        {request.reason === null ? null : (
          <p className="text-subtle-foreground">
            Its reason, in its own words: &ldquo;{request.reason}&rdquo;
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={buttonsDisabled}
          onClick={() => onDecide({ decision: "deny" })}
        >
          Deny
        </Button>
        {request.level === "read" ? null : (
          <Button
            variant="secondary"
            size="sm"
            disabled={buttonsDisabled}
            onClick={() => onDecide({ decision: "allow", level: "read" })}
          >
            Read pages only
          </Button>
        )}
        <Button
          size="sm"
          disabled={buttonsDisabled}
          onClick={() => onDecide({ decision: "allow" })}
        >
          Allow
        </Button>
      </div>
    </div>
  );
}

/**
 * The oldest request, under the tab strip beside the driving indicator — the
 * one row on screen for every desktop route, so the question is seen wherever
 * the person is in Patcher.
 */
export function BrowserAccessRequestBar() {
  const requests = useBrowserAccessRequests();
  const decide = useDecideBrowserAccessRequest();
  const [first, ...rest] = requests.data?.requests ?? [];
  if (first === undefined) return null;
  return (
    <BrowserAccessRequestRow
      // Remounted per request, so the next one arms afresh.
      key={first.id}
      request={first}
      waitingBehind={rest.length}
      disabled={decide.isPending}
      onDecide={(answer) => decide.mutate({ requestId: first.id, ...answer })}
    />
  );
}

/** Every waiting request, in Settings → General → Agents outside Patcher. */
export function BrowserAccessRequestsSettingsControl() {
  const requests = useBrowserAccessRequests();
  const decide = useDecideBrowserAccessRequest();
  const pending = requests.data?.requests ?? [];
  if (pending.length === 0) return null;
  return (
    <div className="space-y-2.5">
      <p className="text-sm font-medium">Waiting for your answer</p>
      <div className="overflow-hidden rounded-md border border-border [&>*:first-child]:border-t-0">
        {pending.map((request) => (
          <BrowserAccessRequestRow
            key={request.id}
            request={request}
            disabled={decide.isPending}
            onDecide={(answer) =>
              decide.mutate({ requestId: request.id, ...answer })
            }
          />
        ))}
      </div>
    </div>
  );
}
