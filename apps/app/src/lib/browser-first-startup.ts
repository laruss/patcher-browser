import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getPatcherDesktopInfo } from "@/lib/patcher-desktop";
import {
  APP_ROOT_ROUTE_PATH,
  BROWSER_SURFACE_ROUTE_PATH,
} from "@/lib/route-paths";

export interface BrowserFirstStartupArgs {
  /**
   * False on the web build, where the browser surface can render no page at all:
   * the native `WebContentsView` belongs to the desktop shell, so the web keeps
   * landing on Patcher's home instead of a surface that would show only its
   * "needs the desktop app" screen.
   */
  isDesktop: boolean;
  /** The pathname the app was opened with. */
  pathname: string;
}

/**
 * Whether a starting app should open the browser surface instead of the route it
 * was loaded with. Only the app's own home is redirected — a start on any other
 * route (a deep link, a reload on settings, a thread URL) is the user's
 * destination and is left alone.
 */
export function shouldStartOnBrowserSurface({
  isDesktop,
  pathname,
}: BrowserFirstStartupArgs): boolean {
  return isDesktop && pathname === APP_ROOT_ROUTE_PATH;
}

/**
 * Browser-first startup: Patcher opens in the browser rather than on its home screen.
 *
 * It fires once per app load, which is what separates "the app starts in the
 * browser" from "the home screen is unreachable" — clicking home later in the
 * session goes to home and stays there. The entry is replaced rather than pushed,
 * so Back does not walk the user out of the browser into the screen they never
 * asked for.
 */
export function useBrowserFirstStartupRoute(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) {
      return;
    }
    hasRunRef.current = true;
    if (
      !shouldStartOnBrowserSurface({
        isDesktop: getPatcherDesktopInfo() !== null,
        pathname: location.pathname,
      })
    ) {
      return;
    }
    void navigate(BROWSER_SURFACE_ROUTE_PATH, { replace: true });
  }, [location.pathname, navigate]);
}
