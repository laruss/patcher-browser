import { useEffect, useRef, useState } from "react";
import type { PatcherDesktopBrowserDialog } from "@patcher/desktop-contract";
import { Icon } from "@patcher/shared-ui/icon";
import { cn } from "@patcher/shared-ui/lib/utils";

/**
 * The app's own replacement for Chromium's native JavaScript dialog.
 *
 * It exists because the shell takes dialogs over the moment a tab's debugger
 * attaches — which is what lets an agent answer one — and Chromium then stops
 * drawing its own. Whatever this renders is what a human sees.
 *
 * It draws inside the panel rather than over it: a `WebContentsView` composites
 * above the DOM, so nothing painted on top of a live page is visible. The main
 * process hides the view while a dialog is open and stands a bitmap of the
 * frozen page in behind this.
 */

export interface BrowserPageDialogProps {
  dialog: NonNullable<PatcherDesktopBrowserDialog["dialog"]>;
  onRespond: (args: { accept: boolean; promptText?: string }) => void;
}

const DIALOG_TITLES: Record<
  NonNullable<PatcherDesktopBrowserDialog["dialog"]>["type"],
  string
> = {
  alert: "This page says",
  confirm: "This page asks",
  prompt: "This page asks",
  beforeunload: "Leave this page?",
};

export function BrowserPageDialog({ dialog, onRespond }: BrowserPageDialogProps) {
  const [promptText, setPromptText] = useState(dialog.defaultPrompt);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const promptRef = useRef<HTMLInputElement>(null);
  const isPrompt = dialog.type === "prompt";
  const canDismiss = dialog.type !== "alert";

  useEffect(() => {
    setPromptText(dialog.defaultPrompt);
    // Focus goes where the answer comes from, so the dialog is keyboard-usable
    // the moment it appears — the native one behaved that way too.
    if (isPrompt) {
      promptRef.current?.select();
    } else {
      confirmRef.current?.focus();
    }
  }, [dialog, isPrompt]);

  const accept = () => {
    onRespond(isPrompt ? { accept: true, promptText } : { accept: true });
  };
  const dismiss = () => {
    onRespond({ accept: false });
  };

  return (
    <div
      className="absolute inset-0 flex items-start justify-center bg-black/40 p-6"
      // The page is blocked behind this, so nothing underneath is interactive
      // anyway; the backdrop is what makes that legible.
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape" && canDismiss) {
          event.stopPropagation();
          dismiss();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={DIALOG_TITLES[dialog.type]}
        className="mt-10 flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-background p-4 shadow-lg"
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-recessed text-muted-foreground">
            <Icon name="Globe" className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {DIALOG_TITLES[dialog.type]}
            </p>
            {/* Page-authored text: rendered as text, never as markup. */}
            <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {dialog.message}
            </p>
          </div>
        </div>

        {isPrompt ? (
          <input
            ref={promptRef}
            value={promptText}
            onChange={(event) => {
              setPromptText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                accept();
              }
            }}
            className="h-8 w-full rounded-md border border-border bg-surface-recessed px-2 text-sm text-foreground outline-none focus-visible:border-ring"
            aria-label="Response"
          />
        ) : null}

        <div className="flex items-center justify-end gap-2">
          {canDismiss ? (
            <button
              type="button"
              onClick={dismiss}
              className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
            >
              Cancel
            </button>
          ) : null}
          <button
            ref={confirmRef}
            type="button"
            onClick={accept}
            className={cn(
              "inline-flex h-8 items-center rounded-md border border-border bg-background px-2.5",
              "text-xs font-medium text-foreground transition-colors hover:bg-state-hover",
            )}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
