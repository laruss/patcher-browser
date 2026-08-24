import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * A request to freeze the browsed page, raised from outside the browser surface.
 *
 * `BrowserSurfaceView` owns the one `setOverlay` call, because there is one page
 * to freeze: two owners writing it for the same tab would have the second one's
 * close thaw the first one's panel. Its own panels reach it as flags, which
 * works because they are below it in the tree — but the thread sidebar and the
 * agent panel are its *siblings* in `AppLayout`, and a dropdown they open is
 * portalled to the document body, where the native view paints straight over
 * it. Those raise a request here instead, and the surface reads the total.
 *
 * Counted rather than a boolean, for the same reason there is a single owner:
 * two menus can be up at once — a sidebar row's context menu over a thread
 * header's dropdown — and the first to close must not thaw the page under the
 * second.
 *
 * Outside the provider every hook here is inert, which is what lets a story or
 * a unit test mount one of these menus alone. The wiring that matters is
 * therefore asserted where it lives: `AppLayout` mounts the provider, and
 * `BrowserSurfaceView.overlay.test.tsx` holds the surface to honouring it.
 */
interface PageOverlayRequestsValue {
  isRequested: boolean;
  acquire: () => () => void;
}

const inert: PageOverlayRequestsValue = {
  isRequested: false,
  acquire: () => () => {},
};

const PageOverlayRequestsContext =
  createContext<PageOverlayRequestsValue>(inert);

export function PageOverlayRequestsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [held, setHeld] = useState(0);
  const acquire = useCallback(() => {
    setHeld((count) => count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setHeld((count) => Math.max(0, count - 1));
    };
  }, []);
  const value = useMemo(
    () => ({ acquire, isRequested: held > 0 }),
    [acquire, held],
  );
  return (
    <PageOverlayRequestsContext.Provider value={value}>
      {children}
    </PageOverlayRequestsContext.Provider>
  );
}

/** Hold the page frozen for as long as `active`. Released on unmount. */
export function useRequestPageOverlay(active: boolean): void {
  const { acquire } = useContext(PageOverlayRequestsContext);
  useEffect(() => {
    if (!active) return;
    return acquire();
  }, [acquire, active]);
}

/** Read by the surface, which owns the single `setOverlay` call. */
export function usePageOverlayRequested(): boolean {
  return useContext(PageOverlayRequestsContext).isRequested;
}

/**
 * The shape a menu needs: track its own open state to hold the freeze, and
 * still hand the caller's `onOpenChange` what it was going to get.
 */
export function usePageOverlayWhileOpen(
  onOpenChange?: (open: boolean) => void,
): (open: boolean) => void {
  const [isOpen, setIsOpen] = useState(false);
  useRequestPageOverlay(isOpen);
  return useCallback(
    (open: boolean) => {
      setIsOpen(open);
      onOpenChange?.(open);
    },
    [onOpenChange],
  );
}
