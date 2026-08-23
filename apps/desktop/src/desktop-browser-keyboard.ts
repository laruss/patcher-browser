/**
 * Turning a key chord like `"Control+Enter"` into the CDP key event Chromium
 * expects.
 *
 * Every field here matters to a different consumer inside the page: `key` is
 * what a `keydown` listener reads, `code` is what a physical-layout check reads,
 * `windowsVirtualKeyCode` is what makes Chromium's own editing commands fire
 * (Backspace deleting, Enter submitting), and `text` is what actually gets
 * inserted. Omitting any of them produces an event that some pages honour and
 * others ignore, which is exactly the nondeterminism automation exists to avoid.
 *
 * This is a deliberately small map. Playwright ships the full USB HID table;
 * what an agent presses is a much shorter list, and an unknown key is refused by
 * name rather than guessed at.
 */

/** Chromium's modifier bitmask for `Input.dispatchKeyEvent`/`dispatchMouseEvent`. */
export const CDP_MODIFIER_ALT = 1;
export const CDP_MODIFIER_CONTROL = 2;
export const CDP_MODIFIER_META = 4;
export const CDP_MODIFIER_SHIFT = 8;

/** Guard on a caller-supplied chord, so nothing unbounded reaches the parser. */
export const PATCHER_BROWSER_MAX_KEY_CHORD_LENGTH = 64;

export interface BrowserKeyEvent {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  /** Empty for keys that insert nothing (Escape, the arrows, F-keys). */
  text: string;
  modifiers: number;
}

const MODIFIER_ALIASES = new Map<string, number>([
  ["alt", CDP_MODIFIER_ALT],
  ["option", CDP_MODIFIER_ALT],
  ["control", CDP_MODIFIER_CONTROL],
  ["ctrl", CDP_MODIFIER_CONTROL],
  ["meta", CDP_MODIFIER_META],
  ["cmd", CDP_MODIFIER_META],
  ["command", CDP_MODIFIER_META],
  ["shift", CDP_MODIFIER_SHIFT],
]);

interface NamedKey {
  code: string;
  keyCode: number;
  text: string;
}

/**
 * Keys that are not a single character. Matched case-insensitively so a model
 * writing `"enter"` is not punished for it, but the emitted `key` is the DOM
 * spelling, because that is what page listeners compare against.
 */
const NAMED_KEYS = new Map<string, NamedKey>([
  ["enter", { code: "Enter", keyCode: 13, text: "\r" }],
  ["tab", { code: "Tab", keyCode: 9, text: "\t" }],
  ["space", { code: "Space", keyCode: 32, text: " " }],
  ["escape", { code: "Escape", keyCode: 27, text: "" }],
  ["esc", { code: "Escape", keyCode: 27, text: "" }],
  ["backspace", { code: "Backspace", keyCode: 8, text: "" }],
  ["delete", { code: "Delete", keyCode: 46, text: "" }],
  ["insert", { code: "Insert", keyCode: 45, text: "" }],
  ["arrowup", { code: "ArrowUp", keyCode: 38, text: "" }],
  ["arrowdown", { code: "ArrowDown", keyCode: 40, text: "" }],
  ["arrowleft", { code: "ArrowLeft", keyCode: 37, text: "" }],
  ["arrowright", { code: "ArrowRight", keyCode: 39, text: "" }],
  ["home", { code: "Home", keyCode: 36, text: "" }],
  ["end", { code: "End", keyCode: 35, text: "" }],
  ["pageup", { code: "PageUp", keyCode: 33, text: "" }],
  ["pagedown", { code: "PageDown", keyCode: 34, text: "" }],
]);

/** The DOM `key` value for each named key, keyed by its lowercase alias. */
const NAMED_KEY_NAMES = new Map<string, string>([
  ["enter", "Enter"],
  ["tab", "Tab"],
  ["space", " "],
  ["escape", "Escape"],
  ["esc", "Escape"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["insert", "Insert"],
  ["arrowup", "ArrowUp"],
  ["arrowdown", "ArrowDown"],
  ["arrowleft", "ArrowLeft"],
  ["arrowright", "ArrowRight"],
  ["home", "Home"],
  ["end", "End"],
  ["pageup", "PageUp"],
  ["pagedown", "PageDown"],
]);

const FUNCTION_KEY_PATTERN = /^f([1-9]|1[0-2])$/u;

/** `code` for a printable character, for pages that read physical layout. */
function codeForCharacter(character: string): string {
  if (/^[a-zA-Z]$/u.test(character)) {
    return `Key${character.toUpperCase()}`;
  }
  if (/^[0-9]$/u.test(character)) {
    return `Digit${character}`;
  }
  // Symbols vary by layout, and a wrong `code` is worse than none: pages that
  // key off `code` are checking physical position, which we cannot know.
  return "";
}

function keyCodeForCharacter(character: string): number {
  if (/^[a-zA-Z0-9]$/u.test(character)) {
    return character.toUpperCase().charCodeAt(0);
  }
  return 0;
}

/** The event for one printable character, as `type` sends them. */
export function characterKeyEvent(character: string): BrowserKeyEvent {
  return {
    key: character,
    code: codeForCharacter(character),
    windowsVirtualKeyCode: keyCodeForCharacter(character),
    text: character,
    modifiers: 0,
  };
}

/**
 * Parse a chord into one key event, or null when the key is not one we can
 * emit. Null rather than a guess: pressing the wrong key on a live page is a
 * side effect, so an unrecognised name has to be refused by name.
 *
 * A trailing `"+"` is the key itself (`"Shift++"`), which is the one place the
 * separator and a legitimate key collide.
 */
export function parseBrowserKeyChord(chord: string): BrowserKeyEvent | null {
  if (
    chord.length === 0 ||
    chord.length > PATCHER_BROWSER_MAX_KEY_CHORD_LENGTH
  ) {
    return null;
  }
  const tokens = chord.split("+");
  // "+" is both the separator and a legitimate key, so it arrives as two empty
  // tokens: "Shift++" splits to ["Shift", "", ""]. One empty tail is a chord
  // with no key at all ("Shift+"), which is not the same thing.
  let keyToken: string | undefined;
  if (
    tokens.length >= 2 &&
    tokens[tokens.length - 1] === "" &&
    tokens[tokens.length - 2] === ""
  ) {
    tokens.splice(-2, 2);
    keyToken = "+";
  } else {
    keyToken = tokens.pop();
  }

  let modifiers = 0;
  if (keyToken === undefined || keyToken.length === 0) {
    return null;
  }
  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES.get(token.toLowerCase());
    if (modifier === undefined) {
      return null;
    }
    modifiers |= modifier;
  }

  const event = keyEventForToken(keyToken);
  if (event === null) {
    return null;
  }
  return applyModifiers(event, modifiers);
}

function keyEventForToken(token: string): BrowserKeyEvent | null {
  const lower = token.toLowerCase();
  const named = NAMED_KEYS.get(lower);
  if (named !== undefined) {
    return {
      key: NAMED_KEY_NAMES.get(lower) ?? token,
      code: named.code,
      windowsVirtualKeyCode: named.keyCode,
      text: named.text,
      modifiers: 0,
    };
  }
  const functionKey = FUNCTION_KEY_PATTERN.exec(lower);
  if (functionKey !== null) {
    const index = Number(functionKey[1]);
    return {
      key: `F${index}`,
      code: `F${index}`,
      windowsVirtualKeyCode: 111 + index,
      text: "",
      modifiers: 0,
    };
  }
  // A single character is the key itself. `Array.from` so an astral character
  // (an emoji) counts as one, not as its two surrogate halves.
  if (Array.from(token).length === 1) {
    return characterKeyEvent(token);
  }
  return null;
}

function applyModifiers(
  event: BrowserKeyEvent,
  modifiers: number,
): BrowserKeyEvent {
  let { key, text } = event;
  if ((modifiers & CDP_MODIFIER_SHIFT) !== 0 && /^[a-z]$/u.test(key)) {
    key = key.toUpperCase();
    text = key;
  }
  // With a command modifier held the keystroke is a shortcut, not text. Leaving
  // `text` set makes Chromium insert the character *and* run the shortcut.
  if ((modifiers & (CDP_MODIFIER_CONTROL | CDP_MODIFIER_META)) !== 0) {
    text = "";
  }
  return { ...event, key, text, modifiers };
}
