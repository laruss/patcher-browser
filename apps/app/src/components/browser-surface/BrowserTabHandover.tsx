import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Button } from "@patcher/shared-ui/button";
import { browserIssuerName } from "@/lib/browser-agent/issuer";
import { getBrowserUrlHost } from "@/lib/browser-url";
import {
  browserTabHandoverAskAtom,
  browserTabOwnersAtom,
  withBrowserTabOwner,
} from "@/lib/browser-agent/tab-owners";
import {
  browserSurfaceTabsAtom,
  getBrowserSurfaceWebTabs,
} from "@/lib/browser-surface-tabs";
import { browserSurfaceTabLabel } from "./BrowserSurfaceTabStrip";

/**
 * "Claude Code is asking for this tab", with the answer beside it.
 *
 * Raised by the refusal itself: a caller outside Patcher may not work in a tab
 * the person opened, and when it tries, the executor records the ask here
 * (`tab-owners.ts`). Without this row the refusal ends with an agent telling
 * the person to hand a tab over and nothing on screen to press — a dead end
 * that reads as the agent being broken.
 *
 * **Why the ask comes from the agent rather than from a menu.** Handing a tab
 * to a particular agent needs both halves — which tab, and which agent — and
 * only one of them is in front of the person. A menu would have to list every
 * grant on the install so they could pick the one they were already talking to;
 * the refusal already knows.
 *
 * The person's other direction, taking a tab back from an agent, is on the tab's
 * own context menu, where the tab is the thing being pointed at.
 */
export function BrowserTabHandover() {
  const [ask, setAsk] = useAtom(browserTabHandoverAskAtom);
  const tabsState = useAtomValue(browserSurfaceTabsAtom);
  const setOwners = useSetAtom(browserTabOwnersAtom);

  if (ask === null) return null;
  const webTabs = getBrowserSurfaceWebTabs(tabsState);
  const tab = webTabs.find((candidate) => candidate.id === ask.tabId);
  // The tab was closed between the ask and now: the question no longer has a
  // subject, and answering it would hand over something that is gone.
  if (tab === undefined) return null;
  const host = getBrowserUrlHost(tab.url);

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-t border-border bg-accent/10 px-3 py-1.5 text-xs"
    >
      <p className="min-w-0 flex-1 truncate">
        <span className="font-medium">{browserIssuerName(ask.issuer)}</span> is
        asking to work in {browserSurfaceTabLabel(tab)}
        {/* The address too, when the title is not it: two tabs a site titles
            the same way — "Inbox", "Dashboard" — are otherwise one name, and
            the tab being given away is the thing to be sure of. */}
        {host.length > 0 && host !== browserSurfaceTabLabel(tab)
          ? ` (${host})`
          : ""}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setAsk(null);
        }}
      >
        Not now
      </Button>
      <Button
        size="sm"
        onClick={() => {
          setOwners((current) =>
            withBrowserTabOwner(current, {
              issuer: ask.issuer,
              openTabIds: webTabs.map((candidate) => candidate.id),
              tabId: ask.tabId,
            }),
          );
          setAsk(null);
        }}
      >
        Hand it over
      </Button>
    </div>
  );
}
