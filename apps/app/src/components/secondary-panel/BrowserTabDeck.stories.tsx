import { useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PatcherDesktopBrowserState } from "@patcher/desktop-contract";
import type { BrowserHistoryEntry } from "@/lib/browser-history";
import { browserHistoryQueryKey } from "@/hooks/queries/query-keys";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { WithDesktopBrowser } from "../../../.ladle/story-desktop";
import { BrowserTabDeck } from "./BrowserTabDeck";

export default {
  title: "right-panel/Browser tab",
};

const noop = () => {};

const EMPTY_TAB_THREAD_ID = "thr_browser_tab_empty_story";
const NARROW_TAB_THREAD_ID = "thr_browser_tab_narrow_story";
const RECENTS_TAB_THREAD_ID = "thr_browser_tab_recents_story";
const LOADING_TAB_THREAD_ID = "thr_browser_tab_loading_story";

// `url` is empty so the tab shows its in-tab new-tab screen rather than a live
// page — the native WebContentsView only exists in the packaged desktop app.
function makeBrowserTab(id: string): BrowserFixedPanelTab {
  return { environmentId: null, id, kind: "browser", title: null, url: "" };
}

const EMPTY_TAB = makeBrowserTab("browser:empty");
const NARROW_TAB = makeBrowserTab("browser:narrow");
const RECENTS_TAB = makeBrowserTab("browser:recents");
const LOADING_TAB: BrowserFixedPanelTab = {
  environmentId: null,
  id: "browser:loading",
  kind: "browser",
  title: "Example Docs",
  url: "https://example.com/docs",
};
const LOADING_BROWSER_STATE: PatcherDesktopBrowserState = {
  tabId: LOADING_TAB.id,
  url: LOADING_TAB.url,
  title: LOADING_TAB.title,
  isLoading: true,
  canGoBack: true,
  canGoForward: false,
  errorText: null,
};

function storyVisit(
  url: string,
  title: string | null,
  minutesAgo: number,
): BrowserHistoryEntry {
  return {
    id: `bhist_${url}`,
    scopeId: RECENTS_TAB_THREAD_ID,
    url,
    title,
    visitCount: 1,
    lastVisitedAt: Date.now() - minutesAgo * 60 * 1000,
  };
}

const RECENT_VISITS: readonly BrowserHistoryEntry[] = [
  storyVisit(
    "https://react.dev/reference/react/useLayoutEffect",
    "useLayoutEffect – React",
    4,
  ),
  storyVisit(
    "https://github.com/anthropics/anthropic-sdk-typescript",
    "anthropics/anthropic-sdk-typescript",
    90,
  ),
  storyVisit(
    "https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver",
    "ResizeObserver - Web APIs | MDN",
    6 * 60,
  ),
  storyVisit("https://localhost:38986/", null, 26 * 60),
];

/**
 * Story-only: seed the history query before the tab mounts so the new-tab
 * screen's "Recently visited" list reads fixtures. History is server-backed
 * now, and there is no server behind a story — the query's refetch fails and
 * react-query keeps what was seeded, which is exactly what the story wants.
 */
function useSeededBrowserHistory(
  scopeId: string,
  entries: readonly BrowserHistoryEntry[],
): void {
  const queryClient = useQueryClient();
  const seeded = useRef(false);
  // Before the first render rather than in an effect: the deck's query runs on
  // mount, and an effect would seed after it had already answered empty.
  if (!seeded.current) {
    seeded.current = true;
    queryClient.setQueryData(browserHistoryQueryKey(scopeId), entries);
  }
}

function PanelStage({
  children,
  width = "wide",
}: {
  children: ReactNode;
  width?: "narrow" | "wide";
}) {
  return (
    <div
      className={
        width === "narrow"
          ? "flex h-[520px] w-[360px] max-w-full min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background"
          : "flex h-[520px] w-full max-w-[760px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background"
      }
    >
      {children}
    </div>
  );
}

interface BrowserTabStageProps {
  history?: readonly BrowserHistoryEntry[];
  tab: BrowserFixedPanelTab;
  threadId: string;
  width?: "narrow" | "wide";
}

function BrowserTabStage({
  history = [],
  tab,
  threadId,
  width,
}: BrowserTabStageProps) {
  useSeededBrowserHistory(threadId, history);
  // A bare box, not a thread's secondary panel: the deck's only host is the
  // browser surface now. A thread that wants to show a page opens a tab there
  // rather than a browser of its own, so a story composing the two would
  // document an arrangement the app no longer has.
  return (
    <PanelStage width={width}>
      <BrowserTabDeck
        browserTabs={[tab]}
        activeBrowserTabId={tab.id}
        canShowNativeBrowserView
        threadId={threadId}
        environmentId={null}
        showChrome={false}
        onUpdate={noop}
      />
    </PanelStage>
  );
}

export function Overview() {
  return (
    <WithDesktopBrowser browserState={LOADING_BROWSER_STATE}>
      <StoryCard>
        <StoryRow
          label="new tab"
          hint="fresh browser tab — the toolbar address bar is the only input, above an empty start page"
        >
          <BrowserTabStage tab={EMPTY_TAB} threadId={EMPTY_TAB_THREAD_ID} />
        </StoryRow>
        <StoryRow
          label="narrow panel"
          hint="360px browser panel; the complete navigation toolbar stays visible and usable without hover"
        >
          <BrowserTabStage
            tab={NARROW_TAB}
            threadId={NARROW_TAB_THREAD_ID}
            width="narrow"
          />
        </StoryRow>
        <StoryRow
          label="recently visited"
          hint="start page with seeded per-thread history, styled like the New tab page rows"
        >
          <BrowserTabStage
            history={RECENT_VISITS}
            tab={RECENTS_TAB}
            threadId={RECENTS_TAB_THREAD_ID}
          />
        </StoryRow>
        <StoryRow
          label="loading page"
          hint="the persistent navigation toolbar replaces Reload with Stop while the page is loading"
        >
          <BrowserTabStage tab={LOADING_TAB} threadId={LOADING_TAB_THREAD_ID} />
        </StoryRow>
      </StoryCard>
    </WithDesktopBrowser>
  );
}
