import { useEffect, useRef, type KeyboardEvent } from "react";
import { PATCHER_DESKTOP_BROWSER_MAX_FIND_QUERY_LENGTH } from "@patcher/desktop-contract";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@patcher/shared-ui/coarse-pointer-sizing";
import { Icon } from "@patcher/shared-ui/icon";
import { cn } from "@patcher/shared-ui/lib/utils";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chromeStyleTokens";
import type { PluginBrowserFindActionContribution } from "@/hooks/queries/plugin-contribution-queries";
import {
  describeBrowserFindMatches,
  type BrowserFindMatches,
} from "@/lib/browser-find";

export interface BrowserFindBarProps {
  /** Plugin buttons, shown after the browser's own controls. */
  actions?: readonly PluginBrowserFindActionContribution[];
  focusToken: number;
  matches: BrowserFindMatches | null;
  onClose: () => void;
  onRunAction?: (action: PluginBrowserFindActionContribution) => void;
  onSearch: (query: string) => void;
  onStep: (direction: 1 | -1) => void;
  query: string;
}

interface FindButtonProps {
  disabled?: boolean;
  icon: "ChevronUp" | "ChevronDown" | "X";
  label: string;
  onClick: () => void;
}

function FindButton({ disabled, icon, label, onClick }: FindButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "flex shrink-0 items-center justify-center transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
        CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
      )}
    >
      <Icon name={icon} aria-hidden />
    </button>
  );
}

/**
 * The browser's find bar.
 *
 * It takes a strip of layout under the chrome instead of floating over the
 * page, and that is forced rather than chosen — see `lib/browser-find.ts`. The
 * page shrinks by this bar's height while it is open, which is what keeps the
 * highlights it just asked for visible.
 *
 * Searching happens on every keystroke, so there is no submit: Enter steps to
 * the next match and Shift+Enter to the previous one, as in every browser.
 */
export function BrowserFindBar({
  actions = [],
  focusToken,
  matches,
  onClose,
  onRunAction,
  onSearch,
  onStep,
  query,
}: BrowserFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus on every open rather than on mount: pressing the shortcut again while
  // the bar is open selects what is in it, which is how a user re-searches.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [focusToken]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    onStep(event.shiftKey ? -1 : 1);
  };

  const hasMatches = matches !== null && matches.matches > 0;

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-sidebar px-2">
      <div className="flex h-8 min-w-0 max-w-md flex-1 items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3">
        <Icon name="Search" className="text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => {
            onSearch(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          // The wire caps the query, and a request over the cap is dropped by
          // the shell's own schema — so stop it here rather than let the bar
          // show text that is not being searched for.
          maxLength={PATCHER_DESKTOP_BROWSER_MAX_FIND_QUERY_LENGTH}
          placeholder="Find in page"
          aria-label="Find in page"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <span
          // Announced as it settles: the count climbs while Chromium scans, so
          // a screen reader hears the final number rather than each partial one.
          aria-live="polite"
          className="shrink-0 text-xs tabular-nums text-muted-foreground"
        >
          {describeBrowserFindMatches(matches)}
        </span>
      </div>
      <FindButton
        icon="ChevronUp"
        label="Previous match"
        disabled={!hasMatches}
        onClick={() => {
          onStep(-1);
        }}
      />
      <FindButton
        icon="ChevronDown"
        label="Next match"
        disabled={!hasMatches}
        onClick={() => {
          onStep(1);
        }}
      />
      {actions.map((action) => (
        <button
          key={`${action.pluginId}:${action.itemId}`}
          type="button"
          // Nothing to act on with an empty bar: every action is about the query.
          disabled={query.length === 0}
          onClick={() => {
            onRunAction?.(action);
          }}
          className="shrink-0 truncate rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
        >
          {action.title}
        </button>
      ))}
      <FindButton icon="X" label="Close find bar" onClick={onClose} />
    </div>
  );
}
