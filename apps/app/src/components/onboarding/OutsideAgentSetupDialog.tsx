import { Button } from "@patcher/shared-ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@patcher/shared-ui/dialog";
import { OnboardingQuestionDialog } from "./OnboardingQuestionDialog";

export interface OutsideAgentSetupDialogContentProps {
  /** The machine the skills would be installed on: the primary host. */
  hostName: string;
  onAccept: () => void;
  onDecline: () => void;
  pending: boolean;
}

/**
 * The one question Patcher asks about agents that are not its own (#141):
 * whether to put its skills where Claude Code, Codex and the rest look for
 * them. Without them an agent asked to use Patcher searches the disk for it.
 *
 * It says where the files go and on which machine, because they land outside
 * Patcher's data directory and are loaded by every session of those agents.
 */
export function OutsideAgentSetupDialogContent({
  hostName,
  onAccept,
  onDecline,
  pending,
}: OutsideAgentSetupDialogContentProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Let other agents use Patcher?</DialogTitle>
        <DialogDescription>
          {`Patcher can install its skills, patcher-cli and patcher-browser, into ~/.agents/skills and ~/.claude/skills on ${hostName}.`}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2 text-sm text-subtle-foreground">
        <p>
          Claude Code, Codex, Cursor and other agents load skills from there in
          every session, so they can reach Patcher and its browser from their
          own terminal.
        </p>
        <p>You can do this later in Settings → Skills.</p>
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onDecline}
        >
          Not now
        </Button>
        <Button type="button" disabled={pending} onClick={onAccept}>
          {pending ? "Setting up…" : "Set up"}
        </Button>
      </DialogFooter>
    </>
  );
}

export interface OutsideAgentSetupDialogProps extends OutsideAgentSetupDialogContentProps {
  open: boolean;
}

/** The #141 question in the shell every launch-time question shares. */
export function OutsideAgentSetupDialog({
  open,
  ...contentProps
}: OutsideAgentSetupDialogProps) {
  return (
    <OnboardingQuestionDialog
      open={open}
      pending={contentProps.pending}
      onDecline={contentProps.onDecline}
    >
      <OutsideAgentSetupDialogContent {...contentProps} />
    </OnboardingQuestionDialog>
  );
}
