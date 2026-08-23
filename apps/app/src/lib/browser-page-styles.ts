import { useEffect } from "react";
import { PATCHER_DESKTOP_BROWSER_MAX_PAGE_STYLES } from "@patcher/desktop-contract";
import { usePluginContributions } from "@/hooks/queries/plugin-contribution-queries";
import { getDesktopBrowserApi } from "./patcher-desktop";

/**
 * Hands the shell the page styles plugins declared, and keeps it current.
 *
 * Mount it above the router, beside the agent bridge, for the same reason that
 * one gives: a style applies to pages, not to a route. A tab styled for GitHub
 * has to stay styled while the user reads a thread, and a plugin installed while
 * they are reading has to take effect without a visit to the browser surface.
 *
 * The list goes over whole — the shell replaces what it holds — and the shell
 * does the matching and the re-applying, because inserted CSS lasts exactly one
 * document and only the shell is there when a page commits.
 */
export function useBrowserPageStyles(): void {
  const styles = usePluginContributions().data?.browserPageStyles;

  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    // Feature-detected, and a missing method means page styles do nothing:
    // there is no second path onto a page, so an older shell is told nothing
    // rather than being sent a payload its strict parser would drop.
    if (browserApi?.setPageStyles === undefined) {
      return;
    }
    // Nothing to say until the list is known. Pushing an empty one while the
    // query is still loading — which is every fresh window — would strip the
    // stylesheets off the pages the user has open and put them back a moment
    // later; "nothing declared" is `[]`, not "not answered yet".
    if (styles === undefined) {
      return;
    }
    browserApi.setPageStyles({
      // Capped to what the shell's parser will accept: over that it drops the
      // whole push and keeps the list it already had, so every plugin's styles
      // would go stale because one plugin declared too many.
      styles: styles
        .slice(0, PATCHER_DESKTOP_BROWSER_MAX_PAGE_STYLES)
        .map((style) => ({
          pluginId: style.pluginId,
          styleId: style.styleId,
          matches: style.matches,
          css: style.css,
        })),
    });
  }, [styles]);
}
