import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@patcher/shared-ui/coarse-pointer-sizing";

/**
 * Geometry and interaction shared by every icon button on the browser's toolbar
 * row — navigation, external-open, downloads.
 *
 * Colour is deliberately **not** here: the navigation buttons take the subtle
 * chrome foreground, while the downloads button tints itself to report an
 * outcome. Folding a foreground into this would have the tint fight it through
 * tailwind-merge at a distance.
 */
export const BROWSER_CHROME_ICON_BUTTON_CLASS = [
  "flex shrink-0 items-center justify-center transition-colors",
  "hover:bg-state-hover hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "disabled:pointer-events-none disabled:opacity-40",
  COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
].join(" ");
