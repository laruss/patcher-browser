import { useRef } from "react";
import {
  EnvironmentRenameDialogContent,
  type EnvironmentRenameDialogTarget,
} from "./EnvironmentRenameDialog";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Environment Rename",
};

const noop = () => {};

const unnamedTarget: EnvironmentRenameDialogTarget = {
  id: "env_unnamed",
  currentName: "",
  branchName: "patcher/support-environment-renaming",
  canClearName: false,
};

const customNameTarget: EnvironmentRenameDialogTarget = {
  id: "env_named",
  currentName: "Review workspace",
  branchName: "patcher/support-environment-renaming",
  canClearName: true,
};

export function Overview() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <StoryCard>
      <StoryRow label="branch placeholder" hint="unnamed environment">
        <DialogStage>
          <EnvironmentRenameDialogContent
            target={unnamedTarget}
            pending={false}
            onRename={noop}
            inputRef={inputRef}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow label="custom name" hint="can clear back to branch name">
        <DialogStage>
          <EnvironmentRenameDialogContent
            target={customNameTarget}
            pending={false}
            onRename={noop}
            inputRef={inputRef}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow label="pending" hint="submit in flight">
        <DialogStage>
          <EnvironmentRenameDialogContent
            target={customNameTarget}
            pending
            onRename={noop}
            inputRef={inputRef}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow label="server error" hint="mutation error surfaced">
        <DialogStage>
          <EnvironmentRenameDialogContent
            target={customNameTarget}
            pending={false}
            errorMessage="Environment name must be 80 characters or fewer."
            onRename={noop}
            inputRef={inputRef}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}
