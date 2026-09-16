import { Button } from "@patcher/shared-ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@patcher/shared-ui/dialog";
import { OnboardingQuestionDialog } from "./OnboardingQuestionDialog";

export interface CliCommandSetupDialogContentProps {
  /** The machine the link would go on: the primary host. */
  hostName: string;
  /** Where the link would go, as the status read measured it. */
  linkPath: string | null;
  onAccept: () => void;
  onDecline: () => void;
  pending: boolean;
}

/**
 * The question about a bare `patcher` on the person's PATH (#147), for an
 * install whose skills answer was recorded because the skills were already
 * there — which is an answer #141's question never got to ask, so the command
 * its yes would have carried was never offered.
 *
 * It names the path, because the link lands outside Patcher's data directory,
 * in a directory every shell on the machine reads.
 */
export function CliCommandSetupDialogContent({
  hostName,
  linkPath,
  onAccept,
  onDecline,
  pending,
}: CliCommandSetupDialogContentProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Run patcher from any terminal?</DialogTitle>
        <DialogDescription>
          {`Patcher can put its patcher command on your PATH on ${hostName}, as a link at ${linkPath ?? "a directory your shell reads"}.`}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2 text-sm text-subtle-foreground">
        <p>
          Patcher&apos;s skills are set up for agents outside it; this lets you
          run patcher yourself from any shell. Your shell profile is not
          changed.
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

export interface CliCommandSetupDialogProps extends CliCommandSetupDialogContentProps {
  open: boolean;
}

/** The #147 question in the shell every launch-time question shares. */
export function CliCommandSetupDialog({
  open,
  ...contentProps
}: CliCommandSetupDialogProps) {
  return (
    <OnboardingQuestionDialog
      open={open}
      pending={contentProps.pending}
      onDecline={contentProps.onDecline}
    >
      <CliCommandSetupDialogContent {...contentProps} />
    </OnboardingQuestionDialog>
  );
}
