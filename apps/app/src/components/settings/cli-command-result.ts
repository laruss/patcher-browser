import type { CliCommandMachine } from "@patcher/server-contract";
import { appToast } from "@/components/ui/app-toast";

/**
 * Say how putting a bare `patcher` on the person's PATH went (#143).
 *
 * Its own module for the reason the skills one beside it gives: two places
 * install — Settings and the launch-time question — and the question should not
 * import the Settings section to say how it went.
 *
 * Three of these are warnings rather than errors, and the difference is not
 * cosmetic. Nothing broke: a name is taken, another `patcher` wins the lookup,
 * or no candidate directory is on PATH. Each is a thing only the person can
 * settle, so each says which path is involved and stops there. A silence where
 * one of these belongs is the failure this exists to prevent — before it, an
 * accept that could not place the link said nothing at all.
 */
export function reportCliCommandResult(machine: CliCommandMachine): void {
  switch (machine.state) {
    case "installed":
      // Only when the disk moved. "It already worked" is not news.
      if (machine.changed) {
        appToast.success(
          `patcher now runs from ${machine.linkPath ?? "your PATH"}`,
        );
      }
      return;
    case "not_on_path":
      appToast.warning(
        `Neither ~/.local/bin nor ~/bin is on your PATH. Add export PATH="${machine.shimDirectory ?? "~/.patcher/bin"}:$PATH" to your shell profile to run patcher from any terminal.`,
      );
      return;
    case "occupied":
      appToast.warning(
        `${machine.existingPath ?? "That name"} is already taken, so patcher was left alone. Remove it yourself if you want Patcher's command there.`,
      );
      return;
    case "shadowed":
      appToast.warning(
        `Another patcher at ${machine.existingPath ?? "an earlier PATH entry"} would answer first, so nothing was linked.`,
      );
      return;
    case "failed":
      appToast.error(machine.message ?? "Could not put patcher on your PATH.");
      return;
    default:
      // `missing`, `unsupported` and `unknown`: nothing happened that the
      // person has to act on, and Settings → Skills shows the state either way.
      return;
  }
}
