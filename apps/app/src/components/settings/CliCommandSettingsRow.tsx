import type { CliCommandMachine } from "@patcher/server-contract";
import { Button } from "@patcher/shared-ui/button";
import { SettingsWithControl } from "@/components/ui/settings-section";
import { useInstallCliCommand } from "@/hooks/mutations/settings-mutations";
import { useCliCommandStatus } from "@/hooks/queries/system-queries";

const CLI_COMMAND_SETTING_LABEL = "The patcher command";

const BADGES: Record<CliCommandMachine["state"], string | null> = {
  installed: "On your PATH",
  missing: "Not on your PATH",
  occupied: "Name taken",
  shadowed: "Another patcher wins",
  not_on_path: "No directory to use",
  unsupported: null,
  unknown: null,
  failed: "Failed",
};

/**
 * One sentence per state, written from what was measured rather than from what
 * was attempted — `installed` means a `patcher` the person's shell actually
 * finds runs this install, and every other state says why it does not.
 */
export function cliCommandDescription(
  machine: CliCommandMachine | null,
): string {
  if (machine === null) {
    return "Connect a machine to run patcher from any shell.";
  }
  switch (machine.state) {
    case "installed":
      return `patcher runs from ${machine.existingPath ?? machine.linkPath ?? "your PATH"}. It points at this install, so it needs nothing set in your shell.`;
    case "missing":
      return `Link patcher into ${machine.linkPath ?? "a directory on your PATH"} so you can run it from any shell. Your shell profile is not touched.`;
    case "occupied":
      return `${machine.existingPath ?? "That name"} is already taken${machine.existingTarget === null ? "" : ` by a link to ${machine.existingTarget}`}. Patcher does not replace a command it did not put there — remove it yourself if you want this one instead.`;
    case "shadowed":
      return `${machine.existingPath ?? "Another patcher"} comes earlier on your PATH and would answer first, so nothing was placed. Remove it, or put this install's directory earlier.`;
    case "not_on_path":
      return `Neither ~/.local/bin nor ~/bin is on your login shell's PATH, so there is nowhere to put it. Add this line to your shell profile instead: export PATH="${machine.shimDirectory ?? "~/.patcher/bin"}:$PATH"`;
    case "unsupported":
      return machine.reason === "dev-install"
        ? "A source checkout never takes the bare patcher; the release it was built beside owns that name. Use bun run patcher here."
        : "Not available on Windows.";
    case "failed":
      return machine.message ?? "Could not put patcher on your PATH.";
    case "unknown":
    default:
      return "Could not read this machine's PATH, so nothing is claimed about it.";
  }
}

export interface CliCommandSettingsRowContentProps {
  machine: CliCommandMachine | null;
  onInstall: () => void;
  pending: boolean;
}

export function CliCommandSettingsRowContent({
  machine,
  onInstall,
  pending,
}: CliCommandSettingsRowContentProps) {
  const badge = machine === null ? null : BADGES[machine.state];
  // A button only where pressing it could change the answer. `occupied` and
  // `shadowed` are the person's to resolve, and `unsupported` never moves.
  const canInstall =
    machine !== null &&
    (machine.state === "missing" || machine.state === "failed");

  return (
    <SettingsWithControl
      label={CLI_COMMAND_SETTING_LABEL}
      {...(badge === null ? {} : { labelBadge: badge })}
      description={cliCommandDescription(machine)}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canInstall || pending}
        onClick={onInstall}
        aria-label={`Install ${CLI_COMMAND_SETTING_LABEL}`}
      >
        {pending ? "Installing…" : "Install"}
      </Button>
    </SettingsWithControl>
  );
}

/**
 * Put a bare `patcher` on the person's PATH (#143), on the machine they type
 * on. Read and written for the primary machine only: a skill is a file an
 * agent reads wherever it runs, but a command is what a person types.
 */
export function CliCommandSettingsRow() {
  const statusQuery = useCliCommandStatus();
  const installCliCommand = useInstallCliCommand();
  const machine = statusQuery.data?.machines[0] ?? null;

  return (
    <CliCommandSettingsRowContent
      machine={machine}
      pending={installCliCommand.isPending}
      onInstall={() => installCliCommand.mutate({})}
    />
  );
}
