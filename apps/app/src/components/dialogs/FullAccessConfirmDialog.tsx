import { Button } from "@patcher/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@patcher/shared-ui/dialog";

/**
 * Where the choice applies, which is also how long it lasts.
 *
 * There is no timer behind this and there should not be: the two scopes Patcher
 * already has *are* the durations. A thread's mode is chosen per turn and the
 * next thread starts from the default again; a machine's limit is the standing
 * answer for every thread on it until its owner changes it back.
 */
export type FullAccessScope = "thread" | "machine";

export interface FullAccessConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: FullAccessScope;
  /** Named in the copy when the choice is a machine's standing limit. */
  machineName?: string;
  onConfirm: () => void;
}

function scopeSentence(scope: FullAccessScope, machineName?: string): string {
  if (scope === "thread") {
    return "This applies to this thread. Other threads keep the sandbox, and the next one starts from it again.";
  }
  return machineName
    ? `This raises the limit for every thread on ${machineName}, now and later, until you lower it again.`
    : "This raises the limit for every thread on this machine, now and later, until you lower it again.";
}

/**
 * The gesture that leaving the sandbox costs.
 *
 * Full Access used to be the third item in the same menu as the two sandboxed
 * presets, one click away and distinguished by a warning tint. It is not a
 * degree of the same thing — it is the absence of the boundary the other two
 * are, so it gets a stop and a list of what opens. The list is deliberately
 * concrete: every line is something the sandboxed modes actually do and this
 * one does not.
 */
export function FullAccessConfirmDialog({
  open,
  onOpenChange,
  scope,
  machineName,
  onConfirm,
}: FullAccessConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <>
            <DialogHeader>
              <DialogTitle>Run without a sandbox?</DialogTitle>
              <DialogDescription>
                Full Access removes the workspace sandbox. The agent runs as
                you, with your files and your logged-in sessions.
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li>Writes are no longer confined to the workspace.</li>
              <li>Commands run without approval.</li>
              <li>
                Patcher&apos;s own credential files stop being protected,
                because a sandbox is where that protection lives.
              </li>
              <li>Network access is unrestricted.</li>
            </ul>
            <p className="text-sm text-muted-foreground">
              {scopeSentence(scope, machineName)}
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Keep the sandbox
              </Button>
              <Button type="button" variant="destructive" onClick={onConfirm}>
                Use Full Access
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
