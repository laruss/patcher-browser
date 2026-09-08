import { useAtomValue } from "jotai";
import { cn } from "@patcher/shared-ui/lib/utils";
import {
  browserActivityAtom,
  type BrowserActivityEntry,
} from "@/lib/browser-agent/activity";
import { browserIssuerName } from "@/lib/browser-agent/issuer";

/**
 * What has driven this browser, so "what did it do" has an answer.
 *
 * The indicator under the tab strip says who is driving *now* and is gone four
 * seconds later ([BrowserDrivingIndicator](../browser-surface/BrowserDrivingIndicator.tsx)).
 * The question this answers is asked afterwards — usually while deciding
 * whether to pause or revoke the grant — so it is here, under the grants and
 * the level, where those two levers are.
 *
 * **Read from the window's own atom rather than passed in**, unlike everything
 * else in this section: the grants are the server's state and this is not. It
 * is what this window heard on the wire while it was open, and saying so in the
 * copy is cheaper than a route, a table and a retention policy for a record
 * whose complete form already exists as `patcher browser trace-start`.
 *
 * **Newest first**, because a list read to answer "what just happened" is read
 * from the top; the log itself is kept oldest-first, which is what makes its
 * cap drop the oldest.
 */

/** The clock a person reads, not the date: these rows are minutes old. */
function formatActivityTime(at: number): string {
  return new Date(at).toLocaleTimeString();
}

/**
 * What became of the command, in the fewest words that stay true.
 *
 * "No answer" is its own state and not a failure: the command timed out or the
 * window performing it went away, and nobody knows whether the browser did it.
 */
function describeActivityStatus(entry: BrowserActivityEntry): string {
  switch (entry.status.kind) {
    case "running":
      return "running";
    case "ok":
      return "done";
    case "failed":
      return entry.status.code === null
        ? "failed"
        : `failed · ${entry.status.code}`;
    case "unanswered":
      return "no answer";
  }
}

export function BrowserActivitySettingsControl() {
  const entries = useAtomValue(browserActivityAtom);

  return (
    <div className="space-y-2.5">
      <div className="space-y-1">
        <p className="text-sm font-medium">Recent browser commands</p>
        <p className="text-xs text-subtle-foreground">
          What agents and terminals have done in this browser since this window
          opened, newest first. Held in this window only &mdash; a reload starts
          it over, and it carries no screenshots. A caller&rsquo;s own{" "}
          <code className="text-[0.95em]">patcher browser trace-start</code> is
          the complete record.
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-subtle-foreground">
          Nothing outside Patcher has driven this browser.
        </p>
      ) : (
        <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {[...entries].reverse().map((entry) => (
            <li
              key={entry.requestId}
              className="flex items-baseline gap-3 px-3 py-2 text-xs"
            >
              <span className="shrink-0 tabular-nums text-subtle-foreground">
                {formatActivityTime(entry.at)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {browserIssuerName(entry.issuer)}
                </p>
                <p className="truncate text-subtle-foreground">
                  {entry.command === null
                    ? // A frame from a server that sent no command with it.
                      "a browser command"
                    : entry.command.detail === ""
                      ? entry.command.name
                      : `${entry.command.name} · ${entry.command.detail}`}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0",
                  entry.status.kind === "failed" ||
                    entry.status.kind === "unanswered"
                    ? "text-warning-text"
                    : "text-subtle-foreground",
                )}
              >
                {describeActivityStatus(entry)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
