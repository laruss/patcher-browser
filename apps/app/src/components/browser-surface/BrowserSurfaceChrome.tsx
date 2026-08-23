import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { PatcherDesktopBrowserState } from "@patcher/desktop-contract";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@patcher/shared-ui/coarse-pointer-sizing";
import { Icon } from "@patcher/shared-ui/icon";
import { cn } from "@patcher/shared-ui/lib/utils";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chromeStyleTokens";
import { runPluginOmniboxAction } from "@/hooks/queries/plugin-contribution-queries";
import { useDefaultBrowserStatus } from "@/hooks/useDefaultBrowserStatus";
import {
  getPatcherDesktopInfo,
  getDesktopBrowserApi,
} from "@/lib/patcher-desktop";
import { resolveBrowserPageSecurity } from "@/lib/browser-page-security";
import { useBrowserSearchEngine } from "@/lib/browser-search-engine";
import {
  nextOmniboxHighlight,
  resolveOmniboxDefaultAction,
  useOmnibox,
  type OmniboxAction,
  type OmniboxProvider,
  type OmniboxSuggestion,
} from "@/lib/omnibox";
import {
  resolveBrowserDownloadsBadge,
  useAcknowledgeBrowserDownloads,
  useBrowserDownloadActions,
  useBrowserDownloads,
} from "@/lib/browser-downloads";
import {
  BrowserDownloadsButton,
  BrowserDownloadsPanel,
} from "./BrowserDownloads";
import { BrowserOmniboxSuggestions } from "./BrowserOmniboxSuggestions";
import { BrowserPluginToolbar } from "./BrowserPluginToolbar";
import { BrowserSiteInfo } from "./BrowserSiteInfo";

export interface BrowserSurfaceChromeProps {
  /**
   * Whether this tab's page is being served under a certificate a human accepted
   * after Chromium refused it, as the shell reports it (`onPageSecurity`).
   *
   * The one fact the padlock cannot get from the URL, and the reason it used to
   * lie. Defaults to false, which is what an older shell — and the web build,
   * which has no browser at all — leaves it as.
   */
  certificateTrustedByUser?: boolean;
  /** Tab switches are surface state, so the surface performs them. */
  onActivateTab: (tabId: string) => void;
  /**
   * Go to one of Patcher's own screens. A route, not a page: the window's router
   * takes it and the strip opens or focuses the destination's tab, which is why
   * this cannot go through `desktopBrowser.navigate`.
   */
  onOpenAppRoute: (path: string) => void;
  /**
   * Reports whether this row's panels need the page frozen, instead of freezing
   * it here.
   *
   * There is one page to freeze and one shell call that freezes it, so there can
   * be only one caller: with two, closing the tab switcher thaws the page under
   * an open downloads list, the native view composites back over the DOM, and
   * the panel that is still open becomes invisible and unclickable. The surface
   * combines this with its own panels and makes the single call.
   */
  onPageOverlayChange: (active: boolean) => void;
  providers: readonly OmniboxProvider[];
  /** The active tab, whose native view this chrome drives. */
  tabId: string;
  url: string;
}

/**
 * The selected row, tagged with the query it belongs to. Tagging rather than
 * resetting on change: providers settle one at a time for a single query, so the
 * selection has to survive re-ranking within a query while never carrying over
 * to the next one.
 */
interface OmniboxHighlight {
  index: number;
  query: string;
}

const NO_OMNIBOX_HIGHLIGHT: OmniboxHighlight = { index: -1, query: "" };

interface ChromeButtonProps {
  disabled?: boolean;
  icon: "ChevronLeft" | "ChevronRight" | "RotateCcw" | "X" | "ExternalLink";
  label: string;
  onClick: () => void;
}

const OMNIBOX_LISTBOX_ID = "browser-omnibox-suggestions";

function omniboxOptionId(index: number): string {
  return `browser-omnibox-option-${index}`;
}

function ChromeButton({ disabled, icon, label, onClick }: ChromeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "flex shrink-0 items-center justify-center transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
        CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
      )}
    >
      <Icon name={icon} aria-hidden />
    </button>
  );
}

/**
 * The browser surface's own navigation chrome, replacing the address bar that
 * `BrowserTabContent` renders for the thread panel (which is why the surface
 * passes `showChrome={false}` to the deck).
 *
 * The address input is an omnibox: it collects suggestions from providers while
 * the user types, and only the providers know where suggestions come from —
 * which is what lets a plugin add a source later without this component
 * changing.
 *
 * Navigation state is read straight from the native view's own event stream
 * rather than lifted out of `BrowserTabContent`, so a navigation re-renders this
 * strip alone and not the deck below it.
 */
export function BrowserSurfaceChrome({
  certificateTrustedByUser = false,
  onActivateTab,
  onOpenAppRoute,
  onPageOverlayChange,
  providers,
  tabId,
  url,
}: BrowserSurfaceChromeProps) {
  const desktopBrowser = useMemo(() => getDesktopBrowserApi(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const locationShortcut = useAppCommandShortcut("browser.focusLocation");
  const [pushedState, setPushedState] =
    useState<PatcherDesktopBrowserState | null>(null);
  const [draft, setDraft] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [highlight, setHighlight] = useState(NO_OMNIBOX_HIGHLIGHT);
  const omnibox = useOmnibox({ providers });
  // The user's engine, Patcher's own or one a plugin declared. Read here rather than
  // passed down: what Enter does is this component's to resolve, and it has to be
  // able to do it synchronously.
  const searchEngine = useBrowserSearchEngine();
  const { status: defaultBrowserStatus } = useDefaultBrowserStatus();
  const downloads = useBrowserDownloads();
  const acknowledgeDownloads = useAcknowledgeBrowserDownloads();
  const { openDownload, revealDownload } = useBrowserDownloadActions();
  const [isDownloadsOpen, setIsDownloadsOpen] = useState(false);
  const [isSiteInfoOpen, setIsSiteInfoOpen] = useState(false);
  const downloadsPanelRef = useRef<HTMLDivElement>(null);
  const downloadsButtonRef = useRef<HTMLDivElement>(null);

  const toggleDownloads = useCallback(() => {
    const next = !isDownloadsOpen;
    setIsDownloadsOpen(next);
    // One page, one freeze: the two panels in this row are mutually exclusive so
    // closing either cannot thaw the page under the other.
    if (next) {
      setIsSiteInfoOpen(false);
    }
    // Opening the list *is* the acknowledgement the button's green and red
    // states are waiting for.
    if (next) {
      acknowledgeDownloads();
    }
  }, [acknowledgeDownloads, isDownloadsOpen]);

  // React cannot draw over a live page — the native view composites above the
  // DOM — so the page is frozen to a bitmap and hidden while either panel in
  // this row is open. That is also what makes the whole window DOM again, so a
  // click on the page area can close them. Reported rather than done here, for
  // the reason on `onPageOverlayChange`.
  const needsPageOverlay = isDownloadsOpen || isSiteInfoOpen;
  useEffect(() => {
    onPageOverlayChange(needsPageOverlay);
    return () => {
      // Never leave a tab frozen behind a panel that is gone.
      onPageOverlayChange(false);
    };
  }, [needsPageOverlay, onPageOverlayChange]);

  useEffect(() => {
    if (!isDownloadsOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target !== null &&
        (downloadsPanelRef.current?.contains(target) === true ||
          downloadsButtonRef.current?.contains(target) === true)
      ) {
        return;
      }
      setIsDownloadsOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isDownloadsOpen]);

  useEffect(() => {
    if (desktopBrowser === null) {
      return;
    }
    return desktopBrowser.onState((next) => {
      if (next.tabId === tabId) {
        setPushedState(next);
      }
    });
  }, [desktopBrowser, tabId]);

  // Only state belonging to the current tab counts. Derived rather than reset on
  // tab change, so the newly activated tab's controls start neutral instead of
  // briefly describing the page the user just left.
  const navigationState = pushedState?.tabId === tabId ? pushedState : null;

  const suggestions = omnibox.suggestions;
  const highlightedIndex =
    highlight.query === omnibox.query ? highlight.index : -1;
  const highlightedSuggestion: OmniboxSuggestion | null =
    highlightedIndex < 0 ? null : (suggestions[highlightedIndex] ?? null);

  const highlightRow = useCallback(
    (index: number) => {
      setHighlight({ index, query: omnibox.query });
    },
    [omnibox.query],
  );

  const closeOmnibox = useCallback(() => {
    omnibox.clear();
    setHighlight(NO_OMNIBOX_HIGHLIGHT);
    setIsEditing(false);
  }, [omnibox]);

  const runAction = useCallback(
    (action: OmniboxAction) => {
      switch (action.type) {
        case "navigate":
          desktopBrowser?.navigate({ tabId, url: action.url });
          break;
        case "activate-tab":
          onActivateTab(action.tabId);
          break;
        case "open-app-tab":
          onOpenAppRoute(action.path);
          break;
        case "plugin-run":
          // The plugin's action runs server-side and may take a moment; the
          // omnibox closes now and the tab navigates only if the plugin asks
          // for it. A failed action leaves the tab where it was rather than
          // sending it somewhere arbitrary.
          void runPluginOmniboxAction({
            itemId: action.itemId,
            pluginId: action.pluginId,
            query: action.query,
          }).then((url) => {
            if (url !== null) {
              desktopBrowser?.navigate({ tabId, url });
            }
          });
          break;
      }
      closeOmnibox();
      // Hand the keyboard back: the page, not the address bar, is what the user
      // just asked for.
      inputRef.current?.blur();
    },
    [closeOmnibox, desktopBrowser, onActivateTab, onOpenAppRoute, tabId],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const action =
        highlightedSuggestion?.action ??
        resolveOmniboxDefaultAction(draft, searchEngine.urlTemplate);
      if (action === null) {
        return;
      }
      runAction(action);
    },
    [draft, highlightedSuggestion, runAction, searchEngine.urlTemplate],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        setDraft(url);
        closeOmnibox();
        inputRef.current?.blur();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }
      if (suggestions.length === 0) {
        return;
      }
      // Otherwise the caret jumps to the start/end of the input instead.
      event.preventDefault();
      highlightRow(
        nextOmniboxHighlight({
          count: suggestions.length,
          current: highlightedIndex,
          step: event.key === "ArrowDown" ? 1 : -1,
        }),
      );
    },
    [closeOmnibox, highlightRow, highlightedIndex, suggestions.length, url],
  );

  const handleChange = useCallback(
    (value: string) => {
      setDraft(value);
      omnibox.setQuery(value);
    },
    [omnibox],
  );

  const focusAddress = useCallback((): boolean => {
    if (desktopBrowser === null) {
      return false;
    }
    setDraft(url);
    setIsEditing(true);
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
    return true;
  }, [desktopBrowser, url]);

  // Above `BrowserTabContent`'s handler: while this chrome is mounted, it owns
  // the address bar. (That one also declines when its own chrome is hidden.)
  useAppCommandHandler("browser.focusLocation", focusAddress, 200);

  // A tab with no page has nothing to read and one thing to do, so the address
  // bar takes focus by itself — on arrival at an empty tab, not only on the one
  // that was just created: landing on the new-tab screen is the same situation
  // however the user got there.
  //
  // Keyed on the tab rather than run once per mount, because the chrome is not
  // remounted when the strip switches tabs. The marker is what makes it once per
  // tab: `focusAddress` changes with every pushed URL, and refocusing on those
  // would take focus back from a user who had already moved on.
  const autoFocusedTabRef = useRef<string | null>(null);
  const hasPage = url.length > 0;
  useEffect(() => {
    if (hasPage) {
      autoFocusedTabRef.current = null;
      return;
    }
    if (autoFocusedTabRef.current === tabId) {
      return;
    }
    autoFocusedTabRef.current = tabId;
    focusAddress();
  }, [focusAddress, hasPage, tabId]);

  if (desktopBrowser === null) {
    return null;
  }

  const isLoading = navigationState?.isLoading ?? false;
  const security = resolveBrowserPageSecurity({
    certificateTrustedByUser,
    url,
  });
  const isOpen = isEditing && suggestions.length > 0;

  return (
    <div
      className="relative z-20 flex shrink-0 flex-col border-b border-border bg-sidebar"
      // Escape closes the downloads list from anywhere in the chrome. There is
      // deliberately no close-on-outside-click: a click on the page lands in a
      // native view and never reaches the DOM, so the behaviour would work
      // everywhere except where a user would most expect it.
      onKeyDown={(event) => {
        if (event.key === "Escape" && isDownloadsOpen) {
          setIsDownloadsOpen(false);
        }
      }}
    >
      {/* `items-start` rather than centred, and no fixed height: the address
          column below grows when the suggestion list opens, and everything
          beside it stays aligned to the pill's own row. */}
      <div className="flex items-start gap-1 px-2 py-1.5">
        <ChromeButton
          icon="ChevronLeft"
          label="Go back"
          disabled={!(navigationState?.canGoBack ?? false)}
          onClick={() => {
            desktopBrowser.goBack(tabId);
          }}
        />
        <ChromeButton
          icon="ChevronRight"
          label="Go forward"
          disabled={!(navigationState?.canGoForward ?? false)}
          onClick={() => {
            desktopBrowser.goForward(tabId);
          }}
        />
        <ChromeButton
          icon={isLoading ? "X" : "RotateCcw"}
          label={isLoading ? "Stop loading" : "Reload"}
          onClick={() => {
            if (isLoading) {
              desktopBrowser.stop(tabId);
              return;
            }
            desktopBrowser.reload(tabId);
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <form onSubmit={handleSubmit}>
            <div className="flex h-8 items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3">
              <BrowserSiteInfo
                onOpenChange={(next) => {
                  setIsSiteInfoOpen(next);
                  if (next) {
                    setIsDownloadsOpen(false);
                  }
                }}
                open={isSiteInfoOpen}
                security={security}
                tabId={tabId}
                url={url}
              />
              <input
                ref={inputRef}
                type="text"
                value={isEditing ? draft : url}
                onChange={(event) => {
                  handleChange(event.target.value);
                }}
                onFocus={() => {
                  setDraft(url);
                  setIsEditing(true);
                  // Both take the same strip of layout under the toolbar, so the
                  // one the user just reached for wins.
                  setIsDownloadsOpen(false);
                }}
                onBlur={closeOmnibox}
                onKeyDown={handleKeyDown}
                placeholder="Search or enter address"
                role="combobox"
                aria-label={
                  locationShortcut
                    ? `Address and search bar (${locationShortcut.label})`
                    : "Address and search bar"
                }
                aria-keyshortcuts={locationShortcut?.ariaKeyshortcuts}
                aria-expanded={isOpen}
                aria-controls={OMNIBOX_LISTBOX_ID}
                aria-activedescendant={
                  highlightedIndex < 0
                    ? undefined
                    : omniboxOptionId(highlightedIndex)
                }
                aria-autocomplete="list"
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent font-mono text-sm text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground"
              />
            </div>
          </form>
          {/* Inside the address column, so the list is exactly the width of the
              input it belongs to. Still in the layout flow rather than an
              overlay: a native `WebContentsView` composites above the DOM, so
              anything drawn over the page area would be invisible in the
              desktop app. See docs/architecture/browser-surface.md. */}
          {isOpen ? (
            <BrowserOmniboxSuggestions
              highlightedIndex={highlightedIndex}
              listboxId={OMNIBOX_LISTBOX_ID}
              onHighlight={highlightRow}
              onSelect={(suggestion) => {
                runAction(suggestion.action);
              }}
              optionId={omniboxOptionId}
              suggestions={suggestions}
            />
          ) : null}
        </div>
        {/* Other people's controls sit between the address bar and Patcher's own, the
            way a browser keeps its extension area — Patcher's buttons stay where the
            user learned them. */}
        <BrowserPluginToolbar
          tabId={tabId}
          title={pushedState?.title ?? null}
          url={url}
        />
        <div ref={downloadsButtonRef} className="contents">
          <BrowserDownloadsButton
            badge={resolveBrowserDownloadsBadge(downloads)}
            isOpen={isDownloadsOpen}
            onToggle={toggleDownloads}
          />
        </div>
        {/* Nothing to hand a link to when Patcher is the browser macOS hands links
            to: Launch Services would route it straight back here as a tab. */}
        {defaultBrowserStatus.isDefault ? null : (
          <ChromeButton
            icon="ExternalLink"
            label="Open in external browser"
            disabled={url.length === 0}
            onClick={() => {
              getPatcherDesktopInfo()?.openExternalUrl(url);
            }}
          />
        )}
      </div>
      {isDownloadsOpen ? (
        <BrowserDownloadsPanel
          entries={downloads.entries}
          onOpen={openDownload}
          onReveal={revealDownload}
          panelRef={downloadsPanelRef}
        />
      ) : null}
    </div>
  );
}
