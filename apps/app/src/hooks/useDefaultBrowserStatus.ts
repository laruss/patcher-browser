import { useCallback, useEffect, useState } from "react";
import type { PatcherDesktopDefaultBrowserStatus } from "@patcher/desktop-contract";
import { getPatcherDesktopInfo } from "@/lib/patcher-desktop";

/**
 * What a build with no shell to ask — the web app — knows about it, and what a
 * shell that predates the question answers.
 */
export const UNAVAILABLE_DEFAULT_BROWSER_STATUS: PatcherDesktopDefaultBrowserStatus =
  {
    canRequest: false,
    isDefault: false,
  };

export interface DefaultBrowserStatusResult {
  /** Ask macOS to route web links to Patcher. The user answers a system dialog. */
  request: () => void;
  status: PatcherDesktopDefaultBrowserStatus;
}

/**
 * Whether macOS hands web links to Patcher.
 *
 * Subscribed as well as read because the answer changes outside this app: the
 * system's own confirmation returns before the user has answered it, and System
 * Settings can change it while Patcher is in the background. The shell re-reads on
 * activation and pushes the difference.
 */
export function useDefaultBrowserStatus(): DefaultBrowserStatusResult {
  const [status, setStatus] = useState<PatcherDesktopDefaultBrowserStatus>(
    UNAVAILABLE_DEFAULT_BROWSER_STATUS,
  );

  useEffect(() => {
    const desktopApi = getPatcherDesktopInfo();
    let cancelled = false;

    const unsubscribe = desktopApi?.onDefaultBrowserStatusChange?.(
      (nextStatus) => {
        setStatus(nextStatus);
      },
    );

    void desktopApi?.getDefaultBrowserStatus?.().then((nextStatus) => {
      if (!cancelled) {
        setStatus(nextStatus);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const request = useCallback(() => {
    void getPatcherDesktopInfo()
      ?.requestDefaultBrowser?.()
      .then((nextStatus) => {
        setStatus(nextStatus);
      });
  }, []);

  return { request, status };
}
