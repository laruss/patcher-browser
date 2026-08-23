import { useEffect, useState } from "react";
import type { PatcherDesktopWindowState } from "@patcher/desktop-contract";
import {
  DEFAULT_DESKTOP_WINDOW_STATE,
  getPatcherDesktopInfo,
} from "@/lib/patcher-desktop";

export function useDesktopWindowState(): PatcherDesktopWindowState {
  const [windowState, setWindowState] = useState<PatcherDesktopWindowState>(
    DEFAULT_DESKTOP_WINDOW_STATE,
  );

  useEffect(() => {
    const desktopApi = getPatcherDesktopInfo();
    let cancelled = false;

    const unsubscribe = desktopApi?.onWindowStateChange?.((nextState) => {
      setWindowState(nextState);
    });

    void desktopApi?.getWindowState?.().then((nextState) => {
      if (!cancelled) {
        setWindowState(nextState);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return windowState;
}
