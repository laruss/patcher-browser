import type { PatcherProjectOption } from "../../shared/contract.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@patcher/shared-ui/select";

const NO_LINK = "__none__";

/**
 * UI state for the linked-patcher-project picker. Shared by NewProjectDialog and
 * the detail rail.
 */
export interface PatcherProjectLinkState {
  /** patcher project id chosen from the Select. */
  selection: string | null;
}

export function emptyPatcherProjectLinkState(): PatcherProjectLinkState {
  return { selection: null };
}

/** Preserve an existing link even when its project is no longer discoverable. */
export function patcherProjectLinkStateFor(
  linkedPatcherProjectId: string | null,
): PatcherProjectLinkState {
  return { selection: linkedPatcherProjectId };
}

/** The Patcher project id the state resolves to; "" means not linked. */
export function resolvePatcherProjectLink(
  state: PatcherProjectLinkState,
): string {
  return state.selection ?? "";
}

export function PatcherProjectLinkPicker({
  state,
  onStateChange,
  patcherProjects,
  noneLabel = "Not linked",
}: {
  state: PatcherProjectLinkState;
  onStateChange: (state: PatcherProjectLinkState) => void;
  patcherProjects: readonly PatcherProjectOption[];
  /** Label for the "no link" Select item (the rail shows "Unlink"). */
  noneLabel?: string;
}) {
  const unavailableSelection =
    state.selection !== null &&
    !patcherProjects.some((project) => project.id === state.selection)
      ? state.selection
      : null;
  return (
    <Select
      value={state.selection ?? NO_LINK}
      onValueChange={(value) =>
        onStateChange({ selection: value === NO_LINK ? null : value })
      }
    >
      <SelectTrigger aria-label="Linked Patcher project" className="h-8">
        <SelectValue>
          {patcherProjects.find((project) => project.id === state.selection)
            ?.name ??
            unavailableSelection ??
            noneLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_LINK}>{noneLabel}</SelectItem>
        {unavailableSelection !== null ? (
          <SelectItem value={unavailableSelection}>
            Unavailable · {unavailableSelection}
          </SelectItem>
        ) : null}
        {patcherProjects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
