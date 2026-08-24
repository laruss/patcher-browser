/**
 * Plugin/registry flavor of the app's `hooks/useBrowserFreezingOverlay.ts`: a
 * no-op. In the host app this hook freezes the native in-app browser
 * `WebContentsView` to a bitmap while a menu drawn over it is open — the
 * lighter half of the pair `useBrowserDimmingModal` completes: a modal covers
 * the whole panel, so the view is hidden outright, while a dropdown leaves the
 * page showing under it and needs it to stay on screen without compositing
 * over the menu. That coordination lives in host state a plugin bundle
 * deliberately does not share. The app injects its real jotai-backed flavor
 * over this file at build time (see apps/app/vite.config.ts's shared-ui env
 * seam); plugins and the vendored registry keep this no-op so the menu
 * components stay byte-identical across every consumer without stripping the
 * call.
 */
export function useBrowserFreezingOverlay(_active: boolean): void {}

/** Host flavor reports live menu state; plugins have none. */
export function useIsBrowserFreezingOverlayOpen(): boolean {
  return false;
}
