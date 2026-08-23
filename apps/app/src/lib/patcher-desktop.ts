import type {
  PatcherDesktopApi,
  PatcherDesktopBrowserApi,
  PatcherDesktopWindowState,
} from "@patcher/desktop-contract";

// The window's title-bar row has pinned chrome at both ends, and the ends are
// independent because they have different owners. These are fixed px geometry
// values because they are paired with Electron/macOS window-control coordinates
// and with a fixed-size button, not with app typography. Both reserves are
// paddings rather than spacer elements, so they transition in lockstep with the
// sidebar slide instead of snapping on/off while the inset animates.
//
// ONE RULE FOR BOTH, and it is the rule these tokens were twice written against:
// a reserve is the **whole** distance from the window edge, and it must be put
// on the element that already carries the surface's own inset. `pl-*`/`pr-*`
// replace one side of a `px-*` on the same element, but *add* to a `px-*` on an
// ancestor — so a reserve written as "the surface's 16px plus N" lands at N on
// some surfaces and at 16 + N on others, and there is no value of N that is
// right for both. Both spellings shipped, and each produced its own overlap:
// tabs under the traffic lights, and the new-tab button under the sidebar
// trigger. Adding a new reserving surface means giving it the inset and the
// reserve on one element.
//
// LEADING (left) — the macOS traffic-light cluster, in a fixed strip of the
// frameless window ending at 84px, which is therefore the whole reserve. It
// depends only on whether the lights are visible: the sidebar is at the other
// end and never covers them. The surfaces:
//  - the page header content row;
//  - the browser surface's tab strip, which draws no page header above it;
//  - the secondary panel's top chrome, while the conversation is collapsed and
//    the panel is flush at the window top-left. That happens on both thread
//    surfaces, not just the split-workspace host: collapsing takes the
//    conversation column to zero width and the thread header rides inside it,
//    so inline thread detail hands over the top-left too. Assuming otherwise is
//    what once left its tab strip sitting under the lights.
export const MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS = "left-[84px]";
export const MACOS_TRAFFIC_LIGHT_LEADING_RESERVE_CLASS = "pl-[84px]";
// The same strip, reserved downwards instead of sideways. A surface that owns
// the whole leading edge — the plugin panel — cannot clear the lights by
// indenting, because it is a column and its content would then be indented all
// the way down. It gives up its first row instead, the same 48px row the
// lights are centred in.
export const MACOS_TRAFFIC_LIGHT_TOP_RESERVE_CLASS = "pt-[48px]";

// TRAILING (right) — the pinned sidebar trigger, which sits beside the panel it
// toggles (see AppLayout's SidebarTriggerOverlay). macOS puts no window controls
// at this end, so one token serves desktop chrome and the web build alike.
//
// The whole gap again: 12px inset + the 28px trigger + an 8px gap = 48, and
// `max-md:pointer-coarse:pr-[56px]` covers the larger 36px touch trigger.
//
// Who reserves it depends on what the trigger is over, and the two cases are
// complementary: with the sidebar **open** it covers the sidebar's own top row,
// so that row reserves it; with the sidebar **collapsed** it covers whatever
// main-area chrome owns the window's top-right, so that chrome does.
export const SIDEBAR_TRIGGER_TRAILING_INSET_CLASS = "pr-[12px]";
export const SIDEBAR_TRIGGER_TRAILING_RESERVE_CLASS =
  "pr-[48px] max-md:pointer-coarse:pr-[56px]";
export const MACOS_WINDOW_DRAG_CLASS =
  "select-none [app-region:drag] [-webkit-app-region:drag]";
export const MACOS_APP_REGION_NO_DRAG_CLASS =
  "[app-region:no-drag] [-webkit-app-region:no-drag]";
export const MACOS_WINDOW_NO_DRAG_CLASS = `relative z-50 ${MACOS_APP_REGION_NO_DRAG_CLASS}`;

// Single source of truth for the top chrome row — the titlebar axis shared by
// the macOS traffic lights, the pinned sidebar collapse trigger, and the
// sidebar's route-history arrows. The native traffic-light inset
// (`MACOS_TRAFFIC_LIGHT_DIAGONAL_INSET` in apps/desktop's window factory) is
// tuned to vertically center the lights within this height and to sit on the
// sidebar icon column's left rail. Electron main and the renderer are separate
// bundles, so they cannot share one runtime value — keep this height and that
// inset in sync as a paired geometry contract.
export const CHROME_ROW_HEIGHT_CLASS = "h-[48px]";
// Base layout for an in-flow chrome row: the shared height, laid out as a flex
// row and vertically centered so its contents share the titlebar axis.
export const CHROME_ROW_CLASS = `flex ${CHROME_ROW_HEIGHT_CLASS} items-center`;

// Single adjustment point for macOS titlebar controls that visually align with
// the native traffic lights. The traffic-light top inset is 18px and the chrome
// row is 48px, so 28px header controls share the same mathematical center; the
// 2px optical nudge below keeps the lucide glyphs visually on the traffic-light
// axis. Keep the offset as a token instead of sprinkling ad hoc translate
// classes; if Electron/macOS geometry changes, the collapse trigger,
// route-history arrows, and page/thread header content can move together from
// here.
export const MACOS_CHROME_CONTROL_AXIS_CLASS =
  "[--patcher-macos-chrome-control-y:2px] [transform:translateY(var(--patcher-macos-chrome-control-y))]";
export const MACOS_CHROME_CONTROL_NO_DRAG_CLASS = `${MACOS_WINDOW_NO_DRAG_CLASS} ${MACOS_CHROME_CONTROL_AXIS_CLASS}`;
export const MACOS_CHROME_TRAFFIC_LIGHT_AXIS_NUDGE_CLASS =
  MACOS_CHROME_CONTROL_AXIS_CLASS;

export type PatcherDesktopInfoResult = PatcherDesktopApi | null;
export const DEFAULT_DESKTOP_WINDOW_STATE: PatcherDesktopWindowState = {
  isFullScreen: false,
};

export function getPatcherDesktopInfo(): PatcherDesktopInfoResult {
  if (typeof window === "undefined") {
    return null;
  }
  return window.patcherDesktop ?? null;
}

export function shouldUseMacosDesktopChrome(
  desktopInfo: PatcherDesktopInfoResult,
): boolean {
  return desktopInfo?.platform === "macos";
}

export function shouldReserveMacosTrafficLights({
  desktopInfo,
  windowState,
}: {
  desktopInfo: PatcherDesktopInfoResult;
  windowState: PatcherDesktopWindowState;
}): boolean {
  return shouldUseMacosDesktopChrome(desktopInfo) && !windowState.isFullScreen;
}

/**
 * Which window this renderer is, or null when nothing says — the web build, or
 * a desktop shell older than the argument that carries it.
 *
 * Null means per-window state falls back to one shared store, which is what
 * every build did before windows could differ. Read it rather than caching it:
 * callers use it while modules initialise, before any provider exists.
 */
export function getDesktopWindowKey(): string | null {
  return getPatcherDesktopInfo()?.windowKey ?? null;
}

/**
 * Ask the shell to close this window, and say whether anything heard.
 *
 * False on the web build and on a shell older than the call, where the caller
 * has to keep whatever it would otherwise have done — an empty window is worse
 * than a window that ignored the request.
 */
export function closeDesktopWindow(): boolean {
  const closeWindow = getPatcherDesktopInfo()?.closeWindow;
  if (closeWindow === undefined) {
    return false;
  }
  closeWindow();
  return true;
}

/**
 * The desktop browser control surface, or `null` on the web build (where
 * `window.patcherDesktop` is undefined). Also tolerates a desktop build whose
 * preload predates the browser surface. This is the single gate for the
 * desktop-only browser tab entry and the `WebContentsView` host.
 */
export function getDesktopBrowserApi(): PatcherDesktopBrowserApi | null {
  return getPatcherDesktopInfo()?.browser ?? null;
}

export function isDesktopBrowserAvailable(): boolean {
  return getDesktopBrowserApi() !== null;
}
