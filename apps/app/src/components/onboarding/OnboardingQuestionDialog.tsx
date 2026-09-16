import type { ReactNode } from "react";
import { Dialog, DialogContent } from "@patcher/shared-ui/dialog";

export interface OnboardingQuestionDialogProps {
  children: ReactNode;
  /** True while the answer is being sent: closing must not answer twice. */
  pending: boolean;
  onDecline: () => void;
  open: boolean;
}

/**
 * The shell shared by the questions Patcher puts to a person at launch (#141,
 * #142), which are alike in how they may be closed.
 *
 * Escape and the close button answer "Not now", so closing one is an answer
 * rather than a way to be asked again next launch. A click outside does
 * nothing: the dialog appears on its own, and a click meant for the app behind
 * it must not answer it. On a narrow window it is a drawer, which would take a
 * tap outside or a swipe down as closing, so there it does not close at all and
 * the buttons are the only answers.
 */
export function OnboardingQuestionDialog({
  children,
  onDecline,
  open,
  pending,
}: OnboardingQuestionDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || pending) return;
        onDecline();
      }}
    >
      <DialogContent
        dismissible={false}
        onInteractOutside={(event) => event.preventDefault()}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
