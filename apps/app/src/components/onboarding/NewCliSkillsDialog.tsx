import type { CliSkillsOffer } from "@patcher/server-contract";
import { Button } from "@patcher/shared-ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@patcher/shared-ui/dialog";
import { OnboardingQuestionDialog } from "./OnboardingQuestionDialog";

export interface NewCliSkillsDialogContentProps {
  offer: CliSkillsOffer;
  onAccept: () => void;
  onDecline: () => void;
  pending: boolean;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The question about a skill that shipped after this install put Patcher's
 * other skills on a machine (#142).
 *
 * Asked rather than installed unasked: these files land in the person's home,
 * outside Patcher's data directory, where every agent on the machine loads
 * them — the same reason the first install is asked for. Asked rather than left
 * out, because nothing else would ever bring it: the machine has no copy of it
 * for Patcher to keep current.
 */
export function NewCliSkillsDialogContent({
  offer,
  onAccept,
  onDecline,
  pending,
}: NewCliSkillsDialogContentProps) {
  const many = offer.skills.length > 1;
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {many
            ? "Install Patcher's new skills for other agents?"
            : "Install Patcher's new skill for other agents?"}
        </DialogTitle>
        <DialogDescription>
          {`Patcher can install ${joinNames(offer.skills)} into ~/.agents/skills and ~/.claude/skills on ${joinNames(
            offer.machines.map((machine) => machine.hostName),
          )}.`}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2 text-sm text-subtle-foreground">
        <p>
          {many
            ? "They came with this version of Patcher, alongside the skills already installed there."
            : "It came with this version of Patcher, alongside the skills already installed there."}
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
          {pending ? "Installing…" : "Install"}
        </Button>
      </DialogFooter>
    </>
  );
}

export interface NewCliSkillsDialogProps extends NewCliSkillsDialogContentProps {
  open: boolean;
}

/** The #142 question in the shell every launch-time question shares. */
export function NewCliSkillsDialog({
  open,
  ...contentProps
}: NewCliSkillsDialogProps) {
  return (
    <OnboardingQuestionDialog
      open={open}
      pending={contentProps.pending}
      onDecline={contentProps.onDecline}
    >
      <NewCliSkillsDialogContent {...contentProps} />
    </OnboardingQuestionDialog>
  );
}
