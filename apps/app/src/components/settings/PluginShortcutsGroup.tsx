import { useMemo } from "react";
import {
  isAppKeybindingAvailableForClient,
  isMacKeyboardPlatform,
  type AppCommandId,
  type AppKeybindings,
  type AppShortcut,
} from "@patcher/domain";
import { AppCommandShortcutPill } from "@/components/commands/AppCommandShortcutHint";
import { getPatcherDesktopInfo } from "@/lib/patcher-desktop";
import {
  formatAppShortcut,
  formatAppShortcutAria,
} from "@/lib/app-keybindings";
import { getAppCommandMetadata } from "@/lib/app-command-metadata";
import { areAppShortcutsEqual } from "@/lib/keyboard-shortcut-settings";
import {
  usePluginContributions,
  type PluginCommandContribution,
} from "@/hooks/queries/plugin-contribution-queries";

const EMPTY_COMMANDS: readonly PluginCommandContribution[] = [];

/**
 * Which plugin commands this search box is asking about. Exported so the section
 * around this group can tell "nothing matches" from "only a plugin's row does"
 * without duplicating the fields the rows match on.
 */
export function filterPluginCommands(
  commands: readonly PluginCommandContribution[],
  search: string,
): readonly PluginCommandContribution[] {
  const query = search.trim().toLowerCase();
  if (query.length === 0) return commands;
  return commands.filter(
    (command) =>
      command.title.toLowerCase().includes(query) ||
      command.pluginId.toLowerCase().includes(query),
  );
}

/**
 * The chord as the keyboard will actually see it, so two shortcuts can be
 * compared the way `matchesAppShortcut` matches them: `mod` is meta on a
 * Mac and control everywhere else, and a plugin that wrote `control: true` where
 * Patcher wrote `mod: true` is claiming the same keystroke on Windows.
 */
function resolveShortcutModifiers(
  shortcut: AppShortcut,
  isMac: boolean,
): AppShortcut {
  return {
    ...shortcut,
    mod: false,
    meta: shortcut.meta || (shortcut.mod && isMac),
    control: shortcut.control || (shortcut.mod && !isMac),
  };
}

export interface PluginShortcutsGroupProps {
  /** Patcher's effective bindings, for spotting a chord a plugin cannot have. */
  keybindings: AppKeybindings;
  platform: string;
  /** The section's search box, matched against the same fields Patcher's rows are. */
  search: string;
}

/**
 * Plugin commands and their chords (`app.commands`), listed after Patcher's own
 * groups.
 *
 * Read-only, deliberately for now: Patcher's rows are editable because their command
 * ids are a closed set the override store keys on, and a plugin's are not. What
 * this group exists to prevent is a chord nobody can find — a shortcut that runs
 * something with no way to see what, or that Patcher's own binding quietly takes.
 */
export function PluginShortcutsGroup({
  keybindings,
  platform,
  search,
}: PluginShortcutsGroupProps) {
  const contributed = usePluginContributions().data?.commands;
  const isDesktop = getPatcherDesktopInfo() !== null;
  const isMac = isMacKeyboardPlatform(platform);
  const rows = useMemo(
    () =>
      filterPluginCommands(contributed ?? EMPTY_COMMANDS, search).map(
        (command) => {
          const chord = resolveShortcutModifiers(command.shortcut, isMac);
          return {
            command,
            // Patcher's own bindings are matched first, so where both apply Patcher's wins.
            // Not "will not run", which would be a false claim: Patcher's bindings are
            // scoped, and a chord Patcher uses only outside the browser (Mod+D is
            // `diff.toggle`, excluded on `browserFocus`) leaves the plugin's
            // command working exactly where a browser-shaped command wants to
            // work.
            sharedWith: keybindings.find(
              (binding) =>
                isAppKeybindingAvailableForClient(binding, {
                  isDesktop,
                  isMac,
                }) &&
                areAppShortcutsEqual(
                  resolveShortcutModifiers(binding.shortcut, isMac),
                  chord,
                ),
            )?.command,
          };
        },
      ),
    [contributed, isDesktop, isMac, keybindings, search],
  );

  if (rows.length === 0) {
    return null;
  }
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium text-subtle-foreground">
        Plugin shortcuts
      </h3>
      <div className="divide-y divide-border">
        {rows.map(({ command, sharedWith }) => (
          <PluginShortcutRow
            key={`${command.pluginId}:${command.commandId}`}
            command={command}
            platform={platform}
            sharedWith={sharedWith}
          />
        ))}
      </div>
    </section>
  );
}

function PluginShortcutRow({
  command,
  platform,
  sharedWith,
}: {
  command: PluginCommandContribution;
  platform: string;
  sharedWith: AppCommandId | undefined;
}) {
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-5">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{command.title}</p>
        <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
          Added by {command.pluginId}
        </p>
        {sharedWith === undefined ? null : (
          <p className="mt-1 text-xs text-warning-text">
            Also used by {getAppCommandMetadata(sharedWith).label}. Where both
            apply, Patcher’s own shortcut wins.
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-start justify-end gap-1">
        <AppCommandShortcutPill
          ariaHidden={false}
          shortcut={{
            ariaKeyshortcuts: formatAppShortcutAria(command.shortcut, platform),
            label: formatAppShortcut(command.shortcut, platform),
          }}
        />
      </div>
    </div>
  );
}
