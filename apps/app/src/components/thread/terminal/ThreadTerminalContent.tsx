import type { TerminalSession } from "@patcher/server-contract";
import { Button } from "@patcher/shared-ui/button";
import { Icon } from "@patcher/shared-ui/icon";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import { ThreadTerminalView } from "./ThreadTerminalView";
import type { ThreadTerminalController } from "./useThreadTerminalController";

interface ThreadTerminalContentProps {
  autoFocus?: boolean;
  controller: ThreadTerminalController;
  onAutoFocusHandled?: () => void;
  onOpenLink?: MarkdownPreviewLinkHandler;
  onSelectionAddToChat?: (text: string) => void;
}

interface InactiveTerminalContent {
  canStartReplacement: boolean;
  description: string | null;
  title: string;
}

interface GetInactiveTerminalContentArgs {
  canCreateTerminal: boolean;
  status: TerminalSession["status"];
}

function getInactiveTerminalContent({
  canCreateTerminal,
  status,
}: GetInactiveTerminalContentArgs): InactiveTerminalContent {
  switch (status) {
    case "disconnected":
      return {
        canStartReplacement: canCreateTerminal,
        description: null,
        title: "Terminal disconnected",
      };
    case "exited":
      return {
        canStartReplacement: false,
        description: null,
        title: "Terminal exited",
      };
    case "starting":
      return {
        canStartReplacement: false,
        description: null,
        title: "Terminal starting",
      };
    case "running":
      return {
        canStartReplacement: false,
        description: null,
        title: "Terminal running",
      };
  }
}

/**
 * Says a terminal is confined, before its shell says "operation not permitted".
 *
 * A terminal an agent opened runs inside the boundary its turn runs in, and the
 * only thing on screen about it used to be the refusal itself — a person typing
 * `touch ~/notes` in one met an error with nothing explaining where it came
 * from. So the fact is stated where they are typing, in the same word the
 * `patcher terminal list` column uses.
 *
 * The network sentence is not padding: the confinement is the filesystem's, on
 * purpose, and leaving it out invites the opposite reading — that `npm install`
 * inside this terminal is also being stopped.
 */
function SandboxedTerminalNotice() {
  return (
    <div className="flex items-start gap-1.5 border-b border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
      <Icon name="Lock" className="mt-px size-3.5 shrink-0" aria-hidden />
      <p>
        <span className="font-medium text-foreground">Sandboxed</span> — writes
        outside the workspace are refused, and so are Patcher&rsquo;s own
        credential files. The network is not restricted.
      </p>
    </div>
  );
}

export function ThreadTerminalContent({
  autoFocus = false,
  controller,
  onAutoFocusHandled,
  onOpenLink,
  onSelectionAddToChat,
}: ThreadTerminalContentProps) {
  // Keep the terminal UI entirely unmounted while its panel is hidden. In
  // particular, mounting ThreadTerminalView initializes xterm and its socket.
  if (!controller.isPanelOpen) {
    return null;
  }

  if (controller.hasTerminalQueryError) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-destructive-text">
        Failed to load terminals.
      </div>
    );
  }

  if (!controller.activeSession) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        {controller.terminalBodyMessage}
      </div>
    );
  }

  const shouldRenderTerminalView =
    controller.activeSession.status === "running" ||
    controller.shouldRetainActiveTerminalView;

  if (!shouldRenderTerminalView) {
    const inactiveContent = getInactiveTerminalContent({
      canCreateTerminal: controller.canCreateTerminal,
      status: controller.activeSession.status,
    });

    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm">
        <div className="flex max-w-md flex-col items-center gap-3">
          <div>
            <p className="font-medium text-foreground">
              {inactiveContent.title}
            </p>
            {inactiveContent.description !== null ? (
              <p className="mt-1 text-muted-foreground">
                {inactiveContent.description}
              </p>
            ) : null}
          </div>
          {inactiveContent.canStartReplacement ? (
            <Button
              type="button"
              size="sm"
              onClick={controller.handleCreateTerminal}
              disabled={controller.isCreateTerminalPending}
            >
              {controller.isCreateTerminalPending ? (
                <Icon name="Spinner" className="size-3.5 animate-spin" />
              ) : (
                <Icon name="Plus" className="size-3.5" />
              )}
              Start new terminal
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {controller.activeSession.sandboxed ? <SandboxedTerminalNotice /> : null}
      <div className="min-h-0 flex-1">
        <ThreadTerminalView
          autoFocus={autoFocus}
          isPanelOpen={controller.isPanelOpen}
          onAutoFocusHandled={onAutoFocusHandled}
          onOpenLink={onOpenLink}
          onSelectionAddToChat={onSelectionAddToChat}
          onSessionChange={controller.handleActiveTerminalSessionChange}
          onTitleChange={controller.handleActiveTerminalTitleChange}
          onUserInput={controller.handleActiveTerminalUserInput}
          session={controller.activeSession}
        />
      </div>
    </div>
  );
}
