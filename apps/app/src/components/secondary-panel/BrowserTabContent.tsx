import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import type {
  PatcherDesktopBrowserDialog,
  PatcherDesktopBrowserPagePromptDetails,
  PatcherDesktopBrowserApi,
  PatcherDesktopBrowserState,
  PatcherDesktopBrowserViewportBounds,
  PatcherDesktopBrowserViewBounds,
} from "@patcher/desktop-contract";
import { clampPatcherDesktopBrowserViewBounds } from "@patcher/desktop-contract";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@patcher/shared-ui/coarse-pointer-sizing";
import { Icon } from "@patcher/shared-ui/icon";
import {
  getPatcherDesktopInfo,
  getDesktopBrowserApi,
} from "@/lib/patcher-desktop";
import { cn } from "@patcher/shared-ui/lib/utils";
import {
  getBrowserUrlSecurity,
  getBrowserUrlHost,
  resolveBrowserAddressInput,
} from "@/lib/browser-url";
import { useBrowserSearchEngine } from "@/lib/browser-search-engine";
import { useBrowserHistory } from "@/lib/browser-history";
import { BROWSER_VIEW_BOUNDS_SYNC_EVENT } from "@/lib/browser-view-bounds-sync";
import { useIsBrowserDimmingModalOpen } from "@/hooks/useBrowserDimmingModal";
import { useDefaultBrowserStatus } from "@/hooks/useDefaultBrowserStatus";
import { usePointerCoarse } from "@patcher/shared-ui/hooks/use-pointer-coarse";
import { BrowserPageDialog } from "@/components/browser-surface/BrowserPageDialog";
import { BrowserPagePrompt } from "@/components/browser-surface/BrowserPagePrompt";
import { resolvePluginBrowserAuth } from "@/hooks/queries/plugin-contribution-queries";
import { BrowserNewTabScreen } from "./BrowserNewTabScreen";
import {
  registerBrowserView,
  type BrowserViewVisibilityCoordinator,
} from "./browserViewVisibilityCoordinator";
import { SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS } from "./panelChromeClasses";
import type { UpdateBrowserTabArgs } from "./useThreadFileTabs";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import type { AppShortcutPresentation } from "@/lib/app-keybindings";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chromeStyleTokens";

export interface BrowserTabContentProps {
  tabId: string;
  initialUrl: string;
  addressFocusRequest: BrowserAddressFocusRequest | null;
  onAddressFocusRequestConsumed?: (request: BrowserAddressFocusRequest) => void;
  /**
   * Whether this browser tab's native view may be visible. The native view
   * stays attached (and its page intact) across deactivation; only its
   * visibility follows this readiness-gated flag, so switching tabs never
   * destroys/reloads it.
   */
  canShowNativeBrowserView: boolean;
  /**
   * Deck-owned coordinator that serializes view visibility so the previously
   * shown view is always hidden before this one is shown (no two native overlays
   * visible at once). Null on the web build, where there is no native view.
   */
  visibilityCoordinator: BrowserViewVisibilityCoordinator | null;
  environmentId: string | null;
  /**
   * Whether this component renders its own navigation bar. The browser surface
   * turns it off because it renders the omnibox chrome itself, above the deck;
   * the thread panel, where the tab content *is* the browser, leaves it on.
   */
  showChrome?: boolean;
  threadId: string;
  onUpdate: (args: UpdateBrowserTabArgs) => void;
  /**
   * The tab's page icon, or null when a navigation left the previous one stale.
   * Optional: only surfaces that show icons subscribe, and an older desktop
   * shell has no favicon channel to subscribe to at all.
   */
  onFavicon?: (args: BrowserTabFaviconArgs) => void;
  /**
   * Whether this tab is loading a page. Optional, and reported only while this
   * component is mounted — the deck mounts one tab at a time, so a surface can
   * show progress for the tab in view and nothing for the rest.
   */
  onLoadingChange?: (args: BrowserTabLoadingArgs) => void;
}

export interface BrowserTabLoadingArgs {
  tabId: string;
  isLoading: boolean;
}

export interface BrowserTabFaviconArgs {
  tabId: string;
  /** A `data:` URI built by the desktop shell — never a page-supplied URL. */
  dataUrl: string | null;
}

export interface BrowserAddressFocusRequest {
  requestId: number;
  tabId: string;
}

interface BrowserChromeProps {
  addressDraft: string;
  isEditing: boolean;
  state: PatcherDesktopBrowserState | null;
  currentUrl: string;
  addressInputRef: RefObject<HTMLInputElement | null>;
  onAddressChange: (value: string) => void;
  onAddressFocus: () => void;
  onAddressBlur: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
  onForward: () => void;
  onReloadOrStop: () => void;
  /**
   * False when Patcher is macOS's own default browser: the link would go to Launch
   * Services and come straight back as a Patcher tab, so the control says nothing
   * true and is not drawn.
   */
  canOpenExternal: boolean;
  onOpenExternal: () => void;
  locationShortcut: AppShortcutPresentation | null;
  reloadShortcut: AppShortcutPresentation | null;
}

interface NavButtonProps {
  icon: "ChevronLeft" | "ChevronRight" | "RotateCcw" | "X" | "ExternalLink";
  label: string;
  disabled?: boolean;
  onClick: () => void;
  shortcut?: AppShortcutPresentation | null;
}

interface BrowserViewBoundsFromElementArgs {
  element: HTMLElement;
}

interface BrowserViewBoundsEqualArgs {
  a: PatcherDesktopBrowserViewBounds;
  b: PatcherDesktopBrowserViewBounds;
}

interface SyncBrowserViewPlacementArgs {
  force: boolean;
}

interface BrowserViewAttachIdentity {
  environmentId: string | null;
  tabId: string;
  threadId: string;
}

interface BrowserPageLoadErrorProps {
  errorText: string;
  /**
   * False when Patcher is macOS's own default browser: the link would go to Launch
   * Services and come straight back as a Patcher tab, so the control says nothing
   * true and is not drawn.
   */
  canOpenExternal: boolean;
  onOpenExternal: () => void;
  onRetry: () => void;
  url: string;
}

const EMPTY_BROWSER_VIEW_BOUNDS: PatcherDesktopBrowserViewBounds = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
};

function roundedBoundsFromRect(rect: DOMRect): PatcherDesktopBrowserViewBounds {
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function browserViewportBounds(): PatcherDesktopBrowserViewportBounds {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

/**
 * Measure the panel rect the native view must overlay, in the renderer's
 * layout coordinate space. This rect is the single placement authority: it is
 * pushed over IPC whenever it changes, at the renderer's own layout cadence
 * (ResizeObserver ticks, window resizes, explicit layout-sync events), so the
 * native overlay always lands where the chrome around it is painted. The
 * desktop main process never extrapolates placement on its own: during native
 * window resize bursts — where no bounds protocol can keep the independently
 * composited overlay glued to the lagging chrome — it hides the view outright
 * and reveals it at the latest pushed rect (clamped to the live window) once
 * the resize settles.
 */
function browserViewBoundsFromElement(
  args: BrowserViewBoundsFromElementArgs,
): PatcherDesktopBrowserViewBounds {
  return clampPatcherDesktopBrowserViewBounds({
    bounds: roundedBoundsFromRect(args.element.getBoundingClientRect()),
    viewport: browserViewportBounds(),
  });
}

function browserViewBoundsEqual(args: BrowserViewBoundsEqualArgs): boolean {
  return (
    args.a.x === args.b.x &&
    args.a.y === args.b.y &&
    args.a.width === args.b.width &&
    args.a.height === args.b.height
  );
}

function isLocalBrowserUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      hostname.startsWith("127.")
    );
  } catch {
    return false;
  }
}

function browserPageLoadErrorTitle(args: {
  errorText: string;
  url: string;
}): string {
  if (isLocalBrowserUrl(args.url)) {
    return "Server not reachable";
  }
  if (args.errorText.includes("ERR_BLOCKED_BY_CLIENT")) {
    return "Page blocked";
  }
  return "Page unavailable";
}

function NavButton({
  icon,
  label,
  disabled,
  onClick,
  shortcut,
}: NavButtonProps) {
  const accessibleLabel = shortcut ? `${label} (${shortcut.label})` : label;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={accessibleLabel}
      aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
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

function BrowserChrome({
  addressDraft,
  isEditing,
  state,
  currentUrl,
  addressInputRef,
  onAddressChange,
  onAddressFocus,
  onAddressBlur,
  onSubmit,
  onBack,
  onForward,
  onReloadOrStop,
  canOpenExternal,
  onOpenExternal,
  locationShortcut,
  reloadShortcut,
}: BrowserChromeProps) {
  const isLoading = state?.isLoading ?? false;
  const security = getBrowserUrlSecurity(currentUrl);
  const addressValue = isEditing ? addressDraft : currentUrl;
  return (
    <div
      data-testid="browser-tab-nav-bar"
      data-state="expanded"
      role="region"
      aria-label="Browser navigation"
      tabIndex={-1}
      className={cn(
        "relative h-11 shrink-0 overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring max-md:pointer-coarse:h-[52px]",
        SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS,
      )}
    >
      <div
        data-testid="browser-tab-nav-controls"
        className={cn(
          "absolute inset-x-0 top-0 flex h-11 translate-y-0 items-center gap-1 px-2 py-1.5 opacity-100 max-md:pointer-coarse:h-[52px]",
        )}
      >
        <NavButton
          icon="ChevronLeft"
          label="Go back"
          disabled={!(state?.canGoBack ?? false)}
          onClick={onBack}
        />
        <NavButton
          icon="ChevronRight"
          label="Go forward"
          disabled={!(state?.canGoForward ?? false)}
          onClick={onForward}
        />
        <NavButton
          icon={isLoading ? "X" : "RotateCcw"}
          label={isLoading ? "Stop loading" : "Reload"}
          shortcut={isLoading ? null : reloadShortcut}
          onClick={onReloadOrStop}
        />
        <form onSubmit={onSubmit} className="min-w-0 flex-1">
          <div className="flex h-8 items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 max-md:pointer-coarse:h-10">
            {security === "secure" ? (
              <Icon
                name="Lock"
                className={cn(
                  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
                  "text-success",
                )}
                aria-label="Secure connection"
              />
            ) : security === "insecure" ? (
              <Icon
                name="AlertTriangle"
                className={cn(
                  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
                  "text-warning",
                )}
                aria-label="Connection not secure"
              />
            ) : (
              <Icon
                name="Search"
                className={cn(
                  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
                  "text-muted-foreground",
                )}
                aria-hidden
              />
            )}
            <input
              ref={addressInputRef}
              type="text"
              value={addressValue}
              onChange={(event) => onAddressChange(event.target.value)}
              onFocus={onAddressFocus}
              onBlur={onAddressBlur}
              placeholder="Enter a URL"
              aria-label={
                locationShortcut
                  ? `Address and search bar (${locationShortcut.label})`
                  : "Address and search bar"
              }
              aria-keyshortcuts={locationShortcut?.ariaKeyshortcuts}
              autoComplete="off"
              spellCheck={false}
              className={cn(
                "min-w-0 flex-1 bg-transparent font-mono text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground",
                COARSE_POINTER_TEXT_SM_CLASS,
              )}
            />
          </div>
        </form>
        {canOpenExternal ? (
          <NavButton
            icon="ExternalLink"
            label="Open in external browser"
            disabled={currentUrl.length === 0}
            onClick={onOpenExternal}
          />
        ) : null}
        {isLoading ? (
          <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
            <span className="block h-full w-1/3 animate-pulse bg-ring/70 motion-reduce:animate-none" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function BrowserUnavailable() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
        <Icon name="Globe" className="size-6" aria-hidden />
      </span>
      <div className="text-sm font-medium text-foreground">
        Browser tabs need the desktop app
      </div>
      <p
        className={cn(
          "max-w-xs text-muted-foreground",
          COARSE_POINTER_TEXT_SM_CLASS,
        )}
      >
        The in-app web browser runs in the Patcher desktop app. Open this thread
        there to browse the web.
      </p>
    </div>
  );
}

function BrowserPageLoadError({
  errorText,
  canOpenExternal,
  onOpenExternal,
  onRetry,
  url,
}: BrowserPageLoadErrorProps) {
  const host = getBrowserUrlHost(url);
  const title = browserPageLoadErrorTitle({ errorText, url });
  const message = isLocalBrowserUrl(url)
    ? `The browser could not reach ${host || "this local server"}. Start the server, then reload.`
    : "The browser could not load this page. Try reloading or opening it externally.";

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="flex w-full max-w-sm flex-col items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-lg border border-border bg-surface-recessed text-muted-foreground">
          <Icon name="Globe" className="size-6" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p
            className={cn(
              "mt-1 text-muted-foreground",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
          >
            {message}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-state-hover"
          >
            <Icon name="RotateCcw" className="size-3.5" aria-hidden />
            Reload
          </button>
          {canOpenExternal ? (
            <button
              type="button"
              onClick={onOpenExternal}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
            >
              <Icon name="ExternalLink" className="size-3.5" aria-hidden />
              Open externally
            </button>
          ) : null}
        </div>
        <p className="max-w-full truncate pt-1 font-mono text-[11px] text-subtle-foreground">
          {errorText}
        </p>
      </div>
    </div>
  );
}

export function BrowserTabContent({
  tabId,
  initialUrl,
  addressFocusRequest,
  onAddressFocusRequestConsumed,
  canShowNativeBrowserView,
  visibilityCoordinator,
  environmentId,
  showChrome = true,
  threadId,
  onUpdate,
  onFavicon,
  onLoadingChange,
}: BrowserTabContentProps) {
  const locationShortcut = useAppCommandShortcut("browser.focusLocation");
  const reloadShortcut = useAppCommandShortcut("browser.reload");
  const desktopBrowser = useMemo<PatcherDesktopBrowserApi | null>(
    () => getDesktopBrowserApi(),
    [],
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const isPointerCoarse = usePointerCoarse();
  const {
    entries: recent,
    recordVisit,
    clear: clearRecent,
  } = useBrowserHistory(threadId);

  const [state, setState] = useState<PatcherDesktopBrowserState | null>(null);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [addressDraft, setAddressDraft] = useState(initialUrl);
  const [isEditing, setIsEditing] = useState(false);
  // Bitmap stand-in pushed by the desktop main process while the native view
  // is hidden during a native window resize; null outside resize bursts.
  const [pageDialog, setPageDialog] =
    useState<PatcherDesktopBrowserDialog["dialog"]>(null);
  // A question from the network — authentication, an untrusted certificate, a
  // client certificate — that the shell is holding the page open for.
  const [pagePrompt, setPagePrompt] =
    useState<PatcherDesktopBrowserPagePromptDetails | null>(null);
  // Hosts a plugin has already answered for in this tab. A second challenge
  // from the same host means the first answer was wrong, so the user is asked
  // rather than the same credentials being replayed forever.
  const pluginAnsweredAuthHostsRef = useRef<Set<string>>(new Set());
  const [resizeSnapshotUrl, setResizeSnapshotUrl] = useState<string | null>(
    null,
  );

  // Keep the latest persistence/visit callbacks in refs so the attach effect can
  // run once per tab without re-subscribing when these identities change.
  const onUpdateRef = useRef(onUpdate);
  const recordVisitRef = useRef(recordVisit);
  onUpdateRef.current = onUpdate;
  recordVisitRef.current = recordVisit;
  // Same purpose as the two above, updated in a layout effect rather than during
  // render: writing a ref in render is what `react-hooks` warns about, and these
  // two are new enough to follow the rule. It runs before the subscribe effect
  // below (declaration order), so the listeners never see an empty ref.
  const onFaviconRef = useRef(onFavicon);
  const onLoadingChangeRef = useRef(onLoadingChange);
  useLayoutEffect(() => {
    onFaviconRef.current = onFavicon;
    onLoadingChangeRef.current = onLoadingChange;
  }, [onFavicon, onLoadingChange]);
  // The URL to load when the view is first created. Captured once so navigation
  // (which updates the persisted `initialUrl` prop) never re-runs the attach
  // effect — and the live view keeps its page across tab switches.
  const initialUrlRef = useRef(initialUrl);
  const [attachedBrowserViewIdentity, setAttachedBrowserViewIdentity] =
    useState<BrowserViewAttachIdentity | null>(null);
  const isBrowserViewAttached =
    attachedBrowserViewIdentity !== null &&
    attachedBrowserViewIdentity.environmentId === environmentId &&
    attachedBrowserViewIdentity.tabId === tabId &&
    attachedBrowserViewIdentity.threadId === threadId;

  const hasPage = currentUrl.length > 0;
  const pageLoadErrorText = state?.errorText ?? null;
  const hasPageLoadError = pageLoadErrorText !== null && hasPage;
  // A blocking modal (e.g. the git-action dialog) dims the panel with a DOM
  // backdrop the native browser overlay cannot sit behind. While one is open,
  // hide the view and fall back to the DOM new-tab screen so the backdrop dims
  // the whole panel.
  const isBrowserDimmingModalOpen = useIsBrowserDimmingModalOpen();
  const lastSentBoundsRef = useRef<PatcherDesktopBrowserViewBounds | null>(
    null,
  );

  const readBounds = useCallback(() => {
    const element = contentRef.current;
    if (element === null) {
      return null;
    }
    return browserViewBoundsFromElement({ element });
  }, []);

  const sendBounds = useCallback(
    (bounds: PatcherDesktopBrowserViewBounds) => {
      if (desktopBrowser === null) {
        return;
      }
      lastSentBoundsRef.current = bounds;
      desktopBrowser.setBounds({ tabId, bounds });
    },
    [desktopBrowser, tabId],
  );

  // Measure and push the current placement synchronously — measurements happen
  // inside ResizeObserver callbacks (post-layout) or force layout themselves,
  // so the rect is always fresh for the frame about to paint.
  const syncPlacement = useCallback(
    ({ force }: SyncBrowserViewPlacementArgs) => {
      const bounds = readBounds();
      if (bounds === null) {
        return;
      }
      const lastSentBounds = lastSentBoundsRef.current;
      if (
        !force &&
        lastSentBounds !== null &&
        browserViewBoundsEqual({ a: lastSentBounds, b: bounds })
      ) {
        return;
      }
      sendBounds(bounds);
    },
    [readBounds, sendBounds],
  );

  // Unconditional push for the coordinator's show() path, so bounds always
  // land before the view is made visible (never a stale/zero-bounds flash on
  // activation).
  const syncBounds = useCallback(() => {
    syncPlacement({ force: true });
  }, [syncPlacement]);

  const syncBoundsIfChanged = useCallback(() => {
    syncPlacement({ force: false });
  }, [syncPlacement]);

  // Initial bounds for attach. When the content element is not measurable yet
  // the dedupe key stays null, so the first layout observation always sends a
  // real placement.
  const syncInitialBounds = useCallback(() => {
    const bounds = readBounds();
    lastSentBoundsRef.current = bounds;
    return bounds ?? EMPTY_BROWSER_VIEW_BOUNDS;
  }, [readBounds]);

  // Create (or re-attach to) the native view on mount and stream navigation
  // state back. Unmount is not ownership teardown: switching threads unmounts
  // the deck, but the native view is intentionally retained so returning to the
  // thread can show the existing page without recreating/reloading it.
  useEffect(() => {
    if (desktopBrowser === null) {
      return;
    }
    const initialBounds = syncInitialBounds();
    const mountUrl = initialUrlRef.current;
    registerBrowserView({ environmentId, tabId, threadId });
    desktopBrowser.attach({
      tabId,
      url: mountUrl,
      bounds: initialBounds,
      // First show is coordinator-owned so it can sync bounds immediately
      // before making the native overlay visible.
      visible: false,
    });
    setAttachedBrowserViewIdentity({ environmentId, tabId, threadId });

    const unsubscribe = desktopBrowser.onState((nextState) => {
      if (nextState.tabId !== tabId) {
        return;
      }
      setState(nextState);
      setCurrentUrl(nextState.url);
      onLoadingChangeRef.current?.({
        tabId,
        isLoading: nextState.isLoading,
      });
      onUpdateRef.current({
        tabId,
        url: nextState.url,
        title: nextState.title,
      });
      if (!nextState.isLoading && nextState.url.length > 0) {
        recordVisitRef.current({
          url: nextState.url,
          title: nextState.title,
        });
      }
    });

    // Optional for version skew: an older shell's preload has no snapshot
    // channel, and the panel falls back to its bare background during resizes.
    const unsubscribeSnapshot = desktopBrowser.onSnapshot?.((snapshot) => {
      if (snapshot.tabId !== tabId) {
        return;
      }
      setResizeSnapshotUrl(snapshot.dataUrl);
    });

    // Dialogs the shell has taken over. Optional for version skew like the rest;
    // a tab whose debugger never attached still gets Chromium's native modal and
    // pushes nothing here.
    const unsubscribeDialog = desktopBrowser.onDialog?.((event) => {
      if (event.tabId !== tabId) {
        return;
      }
      setPageDialog(event.dialog);
    });

    // Questions from the network. Optional for version skew like the rest — an
    // older shell cancels these instead of asking, which is the dead end this
    // channel exists to close.
    const unsubscribePagePrompt = desktopBrowser.onPagePrompt?.((event) => {
      if (event.tabId !== tabId) {
        return;
      }
      const prompt = event.prompt;
      if (prompt === null || prompt.kind !== "auth") {
        setPagePrompt(prompt);
        return;
      }
      const answeredHosts = pluginAnsweredAuthHostsRef.current;
      if (answeredHosts.has(prompt.host)) {
        setPagePrompt(prompt);
        return;
      }
      // Ask the plugins first: a password manager is what makes this prompt
      // unnecessary. Nothing is shown while that is in flight, which is a
      // moment on a page that is already stopped.
      answeredHosts.add(prompt.host);
      void resolvePluginBrowserAuth({
        host: prompt.host,
        insecure: prompt.insecure,
        tabId,
      }).then((credentials) => {
        if (credentials === null) {
          setPagePrompt(prompt);
          return;
        }
        void desktopBrowser.respondToPagePrompt?.({
          tabId,
          id: prompt.id,
          answer: {
            kind: "credentials",
            username: credentials.username,
            password: credentials.password,
          },
        });
      });
    });

    // Also optional for version skew (an older shell pushes no icons), and this
    // component keeps none of it: the icon belongs to the tab, which outlives
    // this mount, so it goes straight to whoever owns the tab list.
    const unsubscribeFavicon = desktopBrowser.onFavicon?.((favicon) => {
      if (favicon.tabId !== tabId) {
        return;
      }
      onFaviconRef.current?.({ tabId, dataUrl: favicon.dataUrl });
    });

    return () => {
      unsubscribe();
      unsubscribeDialog?.();
      unsubscribePagePrompt?.();
      unsubscribeSnapshot?.();
      unsubscribeFavicon?.();
      // Nothing observes this tab's loading state once its content unmounts, so
      // leaving it "loading" would spin forever on a tab nobody is watching.
      onLoadingChangeRef.current?.({ tabId, isLoading: false });
      // The native view survives this unmount. Only explicit tab close/thread
      // deletion owns detach; unmount just disconnects this component's state
      // listener and forgets any stale visibility ownership.
      visibilityCoordinator?.release(tabId);
    };
  }, [
    desktopBrowser,
    environmentId,
    syncInitialBounds,
    visibilityCoordinator,
    tabId,
    threadId,
  ]);

  // Track panel-shape changes. The callback runs post-layout in the frame that
  // will paint the new shape, so measuring and pushing here keeps the native
  // view in lockstep with the chrome as it is actually painted — including
  // during native window drags, where the renderer's relayout (not the OS
  // window size) is what the surrounding chrome reflects.
  useEffect(() => {
    const element = contentRef.current;
    if (element === null || desktopBrowser === null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      syncBoundsIfChanged();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [desktopBrowser, syncBoundsIfChanged]);

  // ResizeObserver only reports size changes, but the content rect can move
  // without resizing: dragging the left sidebar shifts it (AppLayout emits the
  // sync event from the same rAF that applies the live sidebar width), and a
  // native window resize can translate a fixed-size panel. The window resize
  // listener re-measures on the renderer's own layout cadence; the bounds
  // dedupe in syncPlacement drops the no-op ticks.
  useEffect(() => {
    if (desktopBrowser === null) {
      return;
    }

    window.addEventListener(
      BROWSER_VIEW_BOUNDS_SYNC_EVENT,
      syncBoundsIfChanged,
    );
    window.addEventListener("resize", syncBoundsIfChanged);

    return () => {
      window.removeEventListener(
        BROWSER_VIEW_BOUNDS_SYNC_EVENT,
        syncBoundsIfChanged,
      );
      window.removeEventListener("resize", syncBoundsIfChanged);
    };
  }, [desktopBrowser, syncBoundsIfChanged]);

  // The native view is shown whenever this tab has a page, has attached hidden,
  // and the surrounding panel/drawer is ready for the native overlay. It is NOT
  // hidden during a drag-resize — the overlay tracks the live bounds (see the
  // ResizeObserver and layout-sync effects) so it follows the panel smoothly
  // instead of blanking and flashing. It stays attached when hidden, so
  // deactivation never reloads it.
  const isViewVisible =
    canShowNativeBrowserView &&
    hasPage &&
    !hasPageLoadError &&
    isBrowserViewAttached &&
    !isBrowserDimmingModalOpen;
  // A layout effect (pre-paint) declares visibility so showing/hiding lands in
  // the same frame as the DOM tab swap — no flash. Ordering across tabs (hide
  // the previously-visible view BEFORE showing this one) and bounds-before-show
  // are owned by the deck's coordinator, so two native overlays never overlap
  // regardless of the order children's effects run in.
  useLayoutEffect(() => {
    if (visibilityCoordinator === null) {
      return;
    }
    if (isViewVisible) {
      visibilityCoordinator.show(tabId, syncBounds);
      return () => {
        visibilityCoordinator.hide(tabId);
      };
    }
    visibilityCoordinator.hide(tabId);
  }, [visibilityCoordinator, tabId, isViewVisible, syncBounds]);

  useEffect(() => {
    if (addressFocusRequest === null) {
      return;
    }
    if (addressFocusRequest.tabId !== tabId) {
      return;
    }
    if (isPointerCoarse) {
      onAddressFocusRequestConsumed?.(addressFocusRequest);
      return;
    }

    setAddressDraft(currentUrl);
    setIsEditing(true);
    addressInputRef.current?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => {
      addressInputRef.current?.focus({ preventScroll: true });
      onAddressFocusRequestConsumed?.(addressFocusRequest);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    addressFocusRequest,
    currentUrl,
    isPointerCoarse,
    onAddressFocusRequestConsumed,
    tabId,
  ]);

  // The panel's address bar honours the same setting the surface does — one
  // browser, one search engine.
  const searchEngine = useBrowserSearchEngine();
  const navigateToInput = useCallback(
    (rawInput: string) => {
      const url = resolveBrowserAddressInput(
        rawInput,
        searchEngine.urlTemplate,
      );
      if (url === null) {
        return;
      }
      setCurrentUrl(url);
      setIsEditing(false);
      desktopBrowser?.navigate({ tabId, url });
    },
    [desktopBrowser, searchEngine.urlTemplate, tabId],
  );

  const handleAddressSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      navigateToInput(addressDraft);
    },
    [addressDraft, navigateToInput],
  );

  const handleAddressFocus = useCallback(() => {
    setAddressDraft(currentUrl);
    setIsEditing(true);
  }, [currentUrl]);

  const handleReloadOrStop = useCallback(() => {
    if (state?.isLoading ?? false) {
      desktopBrowser?.stop(tabId);
      return;
    }
    desktopBrowser?.reload(tabId);
  }, [desktopBrowser, state?.isLoading, tabId]);

  const handleFocusLocation = useCallback((): boolean => {
    if (!canShowNativeBrowserView || desktopBrowser === null) return false;
    // With the chrome hidden there is no input to focus, so decline and let
    // whoever renders the address bar instead handle the command.
    if (addressInputRef.current === null) return false;
    setAddressDraft(currentUrl);
    setIsEditing(true);
    addressInputRef.current?.focus({ preventScroll: true });
    window.requestAnimationFrame(() => {
      addressInputRef.current?.focus({ preventScroll: true });
      addressInputRef.current?.select();
    });
    return true;
  }, [canShowNativeBrowserView, currentUrl, desktopBrowser]);

  useAppCommandHandler("browser.focusLocation", handleFocusLocation, 100);
  useAppCommandHandler(
    "browser.reload",
    () => {
      if (!canShowNativeBrowserView || desktopBrowser === null || !hasPage) {
        return false;
      }
      desktopBrowser.reload(tabId);
      return true;
    },
    100,
  );

  // Whether "open this elsewhere" can mean anything: when Patcher is the default
  // browser, elsewhere is here.
  const { status: defaultBrowserStatus } = useDefaultBrowserStatus();
  const canOpenExternal = !defaultBrowserStatus.isDefault;

  const handleOpenExternal = useCallback(() => {
    getPatcherDesktopInfo()?.openExternalUrl(currentUrl);
  }, [currentUrl]);

  if (desktopBrowser === null) {
    return <BrowserUnavailable />;
  }

  return (
    <div data-app-browser className="flex h-full min-h-0 flex-col">
      {showChrome ? (
        <BrowserChrome
          addressDraft={addressDraft}
          isEditing={isEditing}
          state={state}
          currentUrl={currentUrl}
          addressInputRef={addressInputRef}
          onAddressChange={setAddressDraft}
          onAddressFocus={handleAddressFocus}
          onAddressBlur={() => setIsEditing(false)}
          onSubmit={handleAddressSubmit}
          onBack={() => {
            desktopBrowser.goBack(tabId);
          }}
          onForward={() => {
            desktopBrowser.goForward(tabId);
          }}
          onReloadOrStop={handleReloadOrStop}
          canOpenExternal={canOpenExternal}
          onOpenExternal={handleOpenExternal}
          locationShortcut={locationShortcut}
          reloadShortcut={reloadShortcut}
        />
      ) : null}
      <div ref={contentRef} className="relative min-h-0 flex-1">
        {hasPageLoadError ? (
          <BrowserPageLoadError
            errorText={pageLoadErrorText}
            canOpenExternal={canOpenExternal}
            onOpenExternal={handleOpenExternal}
            onRetry={handleReloadOrStop}
            url={currentUrl}
          />
        ) : hasPage && !isBrowserDimmingModalOpen ? null : (
          <BrowserNewTabScreen
            onNavigateInput={navigateToInput}
            recent={recent}
            onClearRecent={clearRecent}
            tabId={tabId}
          />
        )}
        {hasPage && resizeSnapshotUrl !== null ? (
          // Stand-in for the hidden native view during a window resize, and for
          // the frozen page behind a dialog. It stretches with the panel — part
          // of the chrome's surface, so it stays glued to the panel however far
          // the chrome paint lags the drag. The live view overlays it again
          // before it is cleared.
          <img
            src={resizeSnapshotUrl}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full"
          />
        ) : null}
        {/* After the placeholder, so it draws over the frozen page rather than
            under it — both are absolutely positioned siblings. */}
        {pagePrompt !== null ? (
          <BrowserPagePrompt
            prompt={pagePrompt}
            onRespond={(answer) => {
              // Clear optimistically, like the dialog above: the shell reveals
              // the page as soon as it has the answer.
              setPagePrompt(null);
              void desktopBrowser?.respondToPagePrompt?.({
                tabId,
                id: pagePrompt.id,
                answer,
              });
            }}
          />
        ) : null}
        {pageDialog !== null ? (
          <BrowserPageDialog
            dialog={pageDialog}
            onRespond={({ accept, promptText }) => {
              // Clear optimistically: the shell reveals the page again as soon
              // as it answers, and a modal lingering over a live view would be
              // invisible anyway but would still swallow clicks.
              setPageDialog(null);
              void desktopBrowser?.respondToDialog?.({
                tabId,
                accept,
                ...(promptText === undefined ? {} : { promptText }),
              });
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
