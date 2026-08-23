import { useEffect } from "react";
import { getPatcherDesktopInfo } from "@/lib/patcher-desktop";
import { useThemePreference } from "./useTheme";

/**
 * Push the renderer's theme preference to the Electron main process so the
 * NSWindow chrome (traffic lights + inactive title-bar) follows Patcher's explicit
 * theme or the OS when set to system. Mounts once at the app root; safely
 * no-ops in the web build where `window.patcherDesktop` is undefined.
 */
export function useDesktopThemeSync(): void {
  const themePreference = useThemePreference();
  useEffect(() => {
    const desktopApi = getPatcherDesktopInfo();
    desktopApi?.setTheme(themePreference);
  }, [themePreference]);
}
