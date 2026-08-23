import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";

import { useMediaQuery } from "./use-media-query.js";

export const COMPACT_VIEWPORT_QUERY = "(max-width: 767px)";

const CompactViewportOverrideContext = createContext<boolean | null>(null);

interface CompactViewportOverrideProviderProps {
  children: ReactNode;
  isCompactViewport: boolean;
}

export function CompactViewportOverrideProvider({
  children,
  isCompactViewport,
}: CompactViewportOverrideProviderProps) {
  return createElement(
    CompactViewportOverrideContext.Provider,
    { value: isCompactViewport },
    children,
  );
}

export function useIsCompactViewport(): boolean {
  const override = useContext(CompactViewportOverrideContext);
  const isCompactViewport = useMediaQuery(COMPACT_VIEWPORT_QUERY);
  if (override !== null) {
    return override;
  }
  return isCompactViewport;
}

/**
 * The window's own answer, with any container override ignored.
 *
 * An overlay portals to `document.body` and lays itself out against the window,
 * not against the box its trigger sits in. So a container that calls itself
 * compact — a side panel one column wide — must not turn a 1440px window's
 * dropdown into a bottom sheet that covers the whole app. Layout *inside* that
 * container still asks {@link useIsCompactViewport}, which is what the override
 * is for.
 */
export function useIsCompactWindow(): boolean {
  return useMediaQuery(COMPACT_VIEWPORT_QUERY);
}
