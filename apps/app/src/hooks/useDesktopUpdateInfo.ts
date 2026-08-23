import { useEffect, useState } from "react";
import type {
  PatcherDesktopApi,
  PatcherDesktopInfo,
} from "@patcher/desktop-contract";
import { getPatcherDesktopInfo } from "@/lib/patcher-desktop";

export interface DesktopUpdateInfo {
  desktopApi: PatcherDesktopApi | null;
  desktopInfo: PatcherDesktopInfo | null;
  /**
   * Whether this is the desktop shell at all. Known on the first render,
   * unlike `desktopInfo`, which only arrives once the shell answers. Callers
   * deciding whether patcher updates itself must gate on this — gating on
   * `desktopInfo` would treat the desktop as a web install until then and
   * surface the npm upgrade path that the desktop never uses.
   */
  isDesktop: boolean;
}

/**
 * Live desktop shell update state. Both fields stay null on the web build.
 * The desktop main process owns the hourly update check; this only mirrors
 * its info object into React state.
 */
export function useDesktopUpdateInfo(): DesktopUpdateInfo {
  // The preload script installs `window.patcherDesktop` before this bundle runs, so
  // the bridge is readable on the first render; only its info is asynchronous.
  const [desktopApi] = useState<PatcherDesktopApi | null>(() =>
    getPatcherDesktopInfo(),
  );
  const [desktopInfo, setDesktopInfo] = useState<PatcherDesktopInfo | null>(
    null,
  );

  useEffect(() => {
    const api = getPatcherDesktopInfo();
    if (api === null) {
      return;
    }

    let mounted = true;
    void api
      .getInfo()
      .then((info) => {
        if (mounted) {
          setDesktopInfo(info);
        }
      })
      .catch(() => undefined);
    const unsubscribe = api.onChange((info) => {
      setDesktopInfo(info);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { desktopApi, desktopInfo, isDesktop: desktopApi !== null };
}
