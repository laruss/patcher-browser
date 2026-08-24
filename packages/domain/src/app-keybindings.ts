import { z } from "zod";

export const THREAD_JUMP_APP_COMMAND_IDS = [
  "thread.jump.1",
  "thread.jump.2",
  "thread.jump.3",
  "thread.jump.4",
  "thread.jump.5",
  "thread.jump.6",
  "thread.jump.7",
  "thread.jump.8",
  "thread.jump.9",
] as const;

export const QUESTION_SELECT_APP_COMMAND_IDS = [
  "question.select.1",
  "question.select.2",
  "question.select.3",
  "question.select.4",
  "question.select.5",
  "question.select.6",
  "question.select.7",
  "question.select.8",
  "question.select.9",
] as const;

export const PANE_FOCUS_APP_COMMAND_IDS = [
  "pane.focus.1",
  "pane.focus.2",
  "pane.focus.3",
  "pane.focus.4",
  "pane.focus.5",
  "pane.focus.6",
  "pane.focus.7",
  "pane.focus.8",
] as const;

/**
 * Jump straight to a browser tab by position. Eight, not nine: the ninth is
 * `browser.selectLastTab`, which is Chromium's rule — `Cmd+9` is the *last* tab
 * however many there are, not the ninth one.
 */
export const BROWSER_SELECT_TAB_APP_COMMAND_IDS = [
  "browser.selectTab.1",
  "browser.selectTab.2",
  "browser.selectTab.3",
  "browser.selectTab.4",
  "browser.selectTab.5",
  "browser.selectTab.6",
  "browser.selectTab.7",
  "browser.selectTab.8",
] as const;

export const APP_COMMAND_IDS = [
  "thread.new",
  "thread.search",
  "thread.rename",
  "thread.archive",
  "thread.previous",
  "thread.next",
  ...THREAD_JUMP_APP_COMMAND_IDS,
  "pane.focus.previous",
  "pane.focus.next",
  ...PANE_FOCUS_APP_COMMAND_IDS,
  "pane.maximize.toggle",
  "pane.close",
  "window.new",
  "settings.open",
  "settings.openServers",
  "sidebar.toggle",
  "panel.newTab",
  "panel.close",
  "panel.toggle",
  "diff.toggle",
  "terminal.open",
  "composer.focus",
  "modelPicker.toggle",
  "modelPicker.cycleModel",
  "modelPicker.cycleReasoning",
  "browser.focusLocation",
  "browser.reload",
  "browser.find",
  "browser.fullscreen.toggle",
  "browser.devTools.toggle",
  "browser.newTab",
  "browser.closeTab",
  "browser.reopenClosedTab",
  ...BROWSER_SELECT_TAB_APP_COMMAND_IDS,
  "browser.selectLastTab",
  "browser.recentTab.next",
  "browser.recentTab.previous",
  "browser.goBack",
  "browser.goForward",
  "browser.zoomIn",
  "browser.zoomOut",
  "browser.zoomReset",
  "browser.print",
  "workspace.openPreferred",
  ...QUESTION_SELECT_APP_COMMAND_IDS,
] as const;

export const appCommandIdSchema = z.enum(APP_COMMAND_IDS);
export type AppCommandId = z.infer<typeof appCommandIdSchema>;

export const APP_COMMAND_CONTEXT_KEYS = [
  "mainSurface",
  "modalOpen",
  "editableFocus",
  "terminalFocus",
  "browserFocus",
  "modelPickerOpen",
  "questionOpen",
  "promptAvailable",
  "splitActive",
  "webSurface",
  "macPlatform",
] as const;

export const appCommandContextKeySchema = z.enum(APP_COMMAND_CONTEXT_KEYS);
export type AppCommandContextKey = z.infer<typeof appCommandContextKeySchema>;
export type AppCommandContext = Record<AppCommandContextKey, boolean>;

export const appShortcutSchema = z
  .object({
    // Store the unshifted base key; `shift` records the modifier separately.
    // For example, Command+Shift+[ is `{ key: "[", shift: true }`.
    key: z.string().min(1).max(32),
    mod: z.boolean(),
    meta: z.boolean(),
    control: z.boolean(),
    alt: z.boolean(),
    shift: z.boolean(),
  })
  .strict();
export type AppShortcut = z.infer<typeof appShortcutSchema>;

export interface AppShortcutInput {
  altKey: boolean;
  /** The physical key (`KeyboardEvent.code`), layout- and modifier-independent. */
  code: string;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

const SHIFTED_KEY_BASES: Readonly<Record<string, string>> = {
  "~": "`",
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  _: "-",
  "+": "=",
  "{": "[",
  "}": "]",
  "|": "\\",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  "?": "/",
};

// The unshifted letter or digit a physical key produces, or null for every
// other key (arrows, punctuation, F-keys), whose `key` is already stable.
function baseKeyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/u.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/u.test(code)) return code.slice(5);
  return null;
}

function isAsciiAlphanumeric(value: string): boolean {
  return /^[a-z0-9]$/iu.test(value);
}

export function normalizeAppShortcutInputKey(input: AppShortcutInput): string {
  if (input.key === " " || input.key === "Spacebar") {
    return "Space";
  }
  // Fall back to the physical key whenever the character produced is NOT a
  // plain letter or digit. Two cases reach this, and the rule is the same for
  // both:
  //
  // - **A non-Latin layout.** Cyrillic reports key "о" for the key labelled J,
  //   Greek reports "ξ", and so on, so every letter chord — Mod+J, Mod+K,
  //   Mod+T — would be unmatchable while that layout is active. The user is
  //   pressing the key the shortcut is printed on; honour that.
  // - **macOS composing Option+<letter>** into another character (Option+M
  //   reports key "µ"), which is why this fallback existed in the first place.
  //
  // Deliberately NOT applied when the character IS a Latin letter or digit,
  // because that is what keeps a Latin non-QWERTY layout matching what the user
  // sees: on AZERTY the key labelled A reports key "a" with code "KeyQ", so
  // Mod+A stays the key labelled A. Preferring the code there would instead
  // bind the chord to whichever key sits where QWERTY puts it.
  if (!isAsciiAlphanumeric(input.key)) {
    const fromCode = baseKeyFromCode(input.code);
    if (fromCode !== null) return fromCode;
  }
  return input.shiftKey
    ? (SHIFTED_KEY_BASES[input.key] ?? input.key)
    : input.key;
}

export function isMacKeyboardPlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/u.test(platform);
}

export function matchesAppShortcut(
  input: AppShortcutInput,
  shortcut: AppShortcut,
  useMetaForMod: boolean,
): boolean {
  const expectedMeta = shortcut.meta || (shortcut.mod && useMetaForMod);
  const expectedControl = shortcut.control || (shortcut.mod && !useMetaForMod);
  return (
    normalizeAppShortcutInputKey(input).toLowerCase() ===
      shortcut.key.toLowerCase() &&
    input.metaKey === expectedMeta &&
    input.ctrlKey === expectedControl &&
    input.altKey === shortcut.alt &&
    input.shiftKey === shortcut.shift
  );
}

export const appCommandWhenSchema = z
  .object({
    all: z.array(appCommandContextKeySchema),
    none: z.array(appCommandContextKeySchema),
  })
  .strict();
export type AppCommandWhen = z.infer<typeof appCommandWhenSchema>;

export const appKeybindingSchema = z
  .object({
    command: appCommandIdSchema,
    desktopOnly: z.boolean(),
    shortcut: appShortcutSchema,
    when: appCommandWhenSchema,
  })
  .strict();
export type AppKeybinding = z.infer<typeof appKeybindingSchema>;

export const appDefaultKeybindingSchema = appKeybindingSchema.extend({
  // Null keeps a command assignable without shipping a default shortcut.
  shortcut: appShortcutSchema.nullable(),
});
export type AppDefaultKeybinding = z.infer<typeof appDefaultKeybindingSchema>;

export function isAppKeybindingAvailableForClient(
  binding: AppKeybinding | AppDefaultKeybinding,
  client: { isDesktop: boolean; isMac: boolean },
): boolean {
  if (binding.desktopOnly && !client.isDesktop) return false;
  if (binding.when.all.includes("webSurface") && client.isDesktop) return false;
  if (binding.when.none.includes("webSurface") && !client.isDesktop)
    return false;
  if (binding.when.all.includes("macPlatform") && !client.isMac) return false;
  if (binding.when.none.includes("macPlatform") && client.isMac) return false;
  return true;
}

export const appKeybindingsSchema = z.array(appKeybindingSchema).max(256);
export type AppKeybindings = z.infer<typeof appKeybindingsSchema>;

export const appDefaultKeybindingsSchema = z
  .array(appDefaultKeybindingSchema)
  .max(256);
export type AppDefaultKeybindings = z.infer<typeof appDefaultKeybindingsSchema>;

export const appKeybindingOverrideSchema = z
  .object({
    command: appCommandIdSchema,
    // Null has explicit meaning: disable every default binding for this command.
    shortcut: appShortcutSchema.nullable(),
  })
  .strict();
export type AppKeybindingOverride = z.infer<typeof appKeybindingOverrideSchema>;

export const appKeybindingOverridesSchema = z
  .array(appKeybindingOverrideSchema)
  .max(APP_COMMAND_IDS.length)
  .superRefine((overrides, context) => {
    const seen = new Set<AppCommandId>();
    for (const [index, override] of overrides.entries()) {
      if (seen.has(override.command)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate override for ${override.command}`,
          path: [index, "command"],
        });
      }
      seen.add(override.command);
    }
  });
export type AppKeybindingOverrides = z.infer<
  typeof appKeybindingOverridesSchema
>;

/**
 * Fold plugin-contributed bindings into the defaults.
 *
 * A separate layer from {@link applyAppKeybindingOverrides}, and *under* it:
 * a plugin decides what this install's defaults are, while an override is the
 * user's own decision and has to win. Folding into the defaults rather than
 * into the overrides is what keeps the settings UI honest — a command a plugin
 * rebound reads as this install's default, not as something the user changed.
 *
 * Keeps the {@link AppDefaultKeybindings} shape, so a plugin can also unassign
 * a command by contributing a null shortcut.
 */
export function applyPluginAppKeybindings(
  defaults: AppDefaultKeybindings,
  bindings: AppKeybindingOverrides,
): AppDefaultKeybindings {
  if (bindings.length === 0) {
    return defaults;
  }
  return defaults.map((binding) => {
    const contributed = bindings.find(
      (candidate) => candidate.command === binding.command,
    );
    return contributed === undefined
      ? binding
      : { ...binding, shortcut: contributed.shortcut };
  });
}

export function applyAppKeybindingOverrides(
  defaults: AppDefaultKeybindings,
  overrides: AppKeybindingOverrides,
): AppKeybindings {
  return defaults.flatMap((binding) => {
    const override = overrides.find(
      (candidate) => candidate.command === binding.command,
    );
    const shortcut =
      override === undefined ? binding.shortcut : override.shortcut;
    return shortcut === null ? [] : [{ ...binding, shortcut }];
  });
}
