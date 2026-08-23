import type { RefObject } from "react";
import { Icon, type IconName } from "@patcher/shared-ui/icon";
import { cn } from "@patcher/shared-ui/lib/utils";
import {
  type BrowserDownloadEntry,
  type BrowserDownloadsBadge,
} from "@/lib/browser-downloads";
import { BROWSER_CHROME_ICON_BUTTON_CLASS } from "./browserChromeButtonClass";

export interface BrowserDownloadsButtonProps {
  badge: BrowserDownloadsBadge;
  isOpen: boolean;
  onToggle: () => void;
}

interface BadgePresentation {
  /** Applied to the icon, so the button's hover background stays neutral. */
  className: string;
  label: string;
}

/**
 * What the button says without being opened.
 *
 * Green and red persist until the list is opened, because a download finishes
 * while the user is reading the page and the toast that announced it is gone
 * seconds later. The animation is the exception: it describes something still
 * happening, so it needs no acknowledgement and ends on its own.
 */
const BADGE_PRESENTATION: Record<
  Exclude<BrowserDownloadsBadge, "hidden">,
  BadgePresentation
> = {
  idle: { className: "", label: "Downloads" },
  downloading: {
    className: "animate-bounce",
    label: "Downloads — in progress",
  },
  done: { className: "text-success", label: "Downloads — finished" },
  error: { className: "text-destructive-text", label: "Downloads — failed" },
};

export function BrowserDownloadsButton({
  badge,
  isOpen,
  onToggle,
}: BrowserDownloadsButtonProps) {
  // Nothing downloaded this session: the browser has no downloads button at
  // all, rather than a button that opens an empty list.
  if (badge === "hidden") {
    return null;
  }
  const presentation = BADGE_PRESENTATION[badge];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={presentation.label}
      aria-expanded={isOpen}
      aria-haspopup="menu"
      className={cn(
        BROWSER_CHROME_ICON_BUTTON_CLASS,
        // Tint wins over the subtle chrome foreground; an untinted button keeps
        // it, and an open one reads as pressed.
        presentation.className.length === 0 && "text-muted-foreground",
        isOpen && "bg-state-active text-foreground",
      )}
    >
      <Icon name="Download" className={presentation.className} aria-hidden />
    </button>
  );
}

export interface BrowserDownloadsPanelProps {
  entries: readonly BrowserDownloadEntry[];
  onOpen: (entry: BrowserDownloadEntry) => void;
  onReveal: (entry: BrowserDownloadEntry) => void;
  /** So the chrome can tell a click inside the panel from one outside it. */
  panelRef: RefObject<HTMLDivElement | null>;
}

interface OutcomePresentation {
  className: string;
  icon: IconName;
  label: string;
}

const OUTCOME_PRESENTATION: Record<
  BrowserDownloadEntry["outcome"],
  OutcomePresentation
> = {
  pending: {
    className: "animate-spin opacity-70",
    icon: "Spinner",
    label: "Downloading",
  },
  done: { className: "text-success", icon: "CircleCheck", label: "Downloaded" },
  error: {
    className: "text-destructive-text",
    icon: "AlertCircle",
    label: "Failed",
  },
};

interface RowActionProps {
  disabled: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
}

function RowAction({ disabled, icon, label, onClick }: RowActionProps) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30"
    >
      <Icon name={icon} className="size-3.5" aria-hidden />
    </button>
  );
}

/**
 * The ten most recent downloads, as a dropdown anchored under the button.
 *
 * It floats over the page, which React cannot normally do here — a native
 * `WebContentsView` composites above the DOM. The surface pays for it by asking
 * the shell to freeze the page to a bitmap and hide the view while this is open
 * (`setOverlay`), which is also what lets a click on the page area close it.
 * See docs/architecture/browser-downloads.md.
 */
export function BrowserDownloadsPanel({
  entries,
  onOpen,
  onReveal,
  panelRef,
}: BrowserDownloadsPanelProps) {
  return (
    <div
      ref={panelRef}
      // Anchored to the toolbar row above it, and above the deck below: the
      // chrome carries the stacking context this sits in.
      className="absolute right-2 top-full z-50 mt-1 flex max-h-[60vh] w-96 max-w-[calc(100vw-1rem)] flex-col overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
      role="menu"
      aria-label="Downloads"
    >
      {entries.map((entry) => {
        const presentation = OUTCOME_PRESENTATION[entry.outcome];
        // Nothing on disk means nothing to act on: a refused download never
        // wrote a file, and neither action has a target.
        const hasFile = entry.savePath !== null;
        return (
          <div
            key={entry.id}
            role="menuitem"
            className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-state-hover"
          >
            <Icon
              name={presentation.icon}
              className={cn("size-3.5 shrink-0", presentation.className)}
              aria-label={presentation.label}
            />
            <span
              className="min-w-0 flex-1 truncate text-foreground"
              title={entry.savePath ?? entry.filename}
            >
              {entry.filename}
            </span>
            <RowAction
              disabled={!hasFile}
              icon="ExternalLink"
              label={`Open ${entry.filename}`}
              onClick={() => {
                onOpen(entry);
              }}
            />
            <RowAction
              disabled={!hasFile}
              icon="FolderOpen"
              label={`Show ${entry.filename} in folder`}
              onClick={() => {
                onReveal(entry);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
