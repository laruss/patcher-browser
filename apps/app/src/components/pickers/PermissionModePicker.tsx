import { useMemo, useState } from "react";
import type { PermissionMode } from "@patcher/domain";
import { LIST_HOVER_TRANSITION } from "@patcher/shared-ui/motion";
import { cn } from "@patcher/shared-ui/lib/utils";
import { FullAccessConfirmDialog } from "@/components/dialogs/FullAccessConfirmDialog";
import { OptionPicker, type PickerOption } from "./OptionPicker";

type PermissionModeOption = PickerOption<PermissionMode>;

function getPermissionModeCompactLabel(value: PermissionMode): string {
  switch (value) {
    case "full":
      return "Full";
    case "accept-edits":
      return "Edits";
    case "auto":
      return "Auto";
  }
}

function addPermissionModeCompactLabels(
  options: readonly PermissionModeOption[],
): PermissionModeOption[] {
  return options.map((option) => ({
    ...option,
    compactLabel:
      option.compactLabel ?? getPermissionModeCompactLabel(option.value),
  }));
}

export interface PermissionModePickerProps {
  value?: PermissionMode;
  options: readonly PickerOption<PermissionMode>[];
  onChange: (value: PermissionMode) => void;
  supported: boolean;
  className?: string;
  /** Render with the dim, hover-to-foreground treatment used inside the prompt box. Defaults to true. */
  muted?: boolean;
  /** Render with the menu open on mount. Story-only escape hatch. */
  defaultOpen?: boolean;
  /** Whether the menu blocks page interaction. Defaults to Radix's true; pass false in stories. */
  modal?: boolean;
  /** Temporary effective mode display; does not change the stored permission value. */
  displayOverride?: {
    label: string;
    compactLabel?: string;
    description?: string;
    title?: string;
  };
  /**
   * Render the picker as a non-interactive, dimmed label (read-only surfaces,
   * e.g. the side chat). The selected mode still shows; the menu never opens.
   */
  disabled?: boolean;
  /** Keep the chevron visible while disabled, used for plan-mode permission locks. */
  showChevronWhenDisabled?: boolean;
}

/**
 * Permission mode picker. Returns null when the provider doesn't support
 * picking (`supported=false`), the current value has not loaded yet, or
 * there's nothing to choose between. A `disabled` picker renders the same
 * selected-mode label as its interactive counterpart, just non-interactive
 * (read-only surfaces, e.g. the side chat).
 */
export function PermissionModePicker({
  value,
  options,
  onChange,
  supported,
  className,
  muted = true,
  defaultOpen,
  modal,
  displayOverride,
  disabled,
  showChevronWhenDisabled,
}: PermissionModePickerProps) {
  const compactOptions = useMemo(
    () => addPermissionModeCompactLabels(options),
    [options],
  );
  // Leaving the sandbox stops here rather than at each call site: the guard
  // belongs to the control, so a surface that adds the picker later cannot
  // forget it. Picking a sandboxed mode is unchanged — going back needs no
  // ceremony.
  const [pendingFullAccess, setPendingFullAccess] = useState(false);
  const handleChange = (next: PermissionMode) => {
    if (next === "full" && value !== "full") {
      setPendingFullAccess(true);
      return;
    }
    onChange(next);
  };
  if (!supported || value === undefined || options.length <= 1) {
    return null;
  }
  return (
    <>
      <FullAccessConfirmDialog
        open={pendingFullAccess}
        onOpenChange={setPendingFullAccess}
        scope="thread"
        onConfirm={() => {
          setPendingFullAccess(false);
          onChange("full");
        }}
      />
      <OptionPicker
        label="Permission mode"
        value={value}
        options={compactOptions}
        onChange={handleChange}
        className={cn(LIST_HOVER_TRANSITION, className)}
        contentClassName="max-w-72"
        muted={muted}
        defaultOpen={defaultOpen}
        modal={modal}
        align="end"
        displayOverride={displayOverride}
        disabled={disabled}
        showChevronWhenDisabled={showChevronWhenDisabled}
      />
    </>
  );
}
