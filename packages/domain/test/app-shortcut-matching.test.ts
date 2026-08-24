import { describe, expect, it } from "vitest";
import {
  matchesAppShortcut,
  normalizeAppShortcutInputKey,
  type AppShortcut,
  type AppShortcutInput,
} from "../src/app-keybindings.js";

/**
 * Which physical key a chord answers to, across keyboard layouts.
 *
 * The rule under test: match the **character the user sees** while that
 * character is a Latin letter or digit, and fall back to the **physical key**
 * when it is not. That is what makes a Latin non-QWERTY layout bind to the key
 * it prints, and a non-Latin layout bind to the key the shortcut is printed on
 * — a Cyrillic keyboard has no "J" to type, so `key` can never match one.
 */
function input(overrides: Partial<AppShortcutInput>): AppShortcutInput {
  return {
    altKey: false,
    code: "",
    ctrlKey: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

function modShortcut(key: string): AppShortcut {
  return {
    alt: false,
    control: false,
    key,
    meta: false,
    mod: true,
    shift: false,
  };
}

describe("normalizeAppShortcutInputKey", () => {
  it("takes the character on a US layout", () => {
    expect(
      normalizeAppShortcutInputKey(input({ code: "KeyJ", key: "j" })),
    ).toBe("j");
  });

  it("takes the physical key when the layout is not Latin", () => {
    // Cyrillic: the key labelled J types "о".
    expect(
      normalizeAppShortcutInputKey(input({ code: "KeyJ", key: "о" })),
    ).toBe("j");
    // Greek: the same key types "ξ".
    expect(
      normalizeAppShortcutInputKey(input({ code: "KeyJ", key: "ξ" })),
    ).toBe("j");
  });

  it("keeps the character on a Latin non-QWERTY layout", () => {
    // AZERTY: the key labelled A is code KeyQ. The chord follows the label, so
    // preferring the code here would move Mod+A to the wrong physical key.
    expect(
      normalizeAppShortcutInputKey(input({ code: "KeyQ", key: "a" })),
    ).toBe("a");
    expect(
      normalizeAppShortcutInputKey(input({ code: "KeyA", key: "q" })),
    ).toBe("q");
  });

  it("still resolves an Option-composed character on macOS", () => {
    expect(
      normalizeAppShortcutInputKey(
        input({ altKey: true, code: "KeyM", key: "µ" }),
      ),
    ).toBe("m");
  });

  it("leaves named keys and punctuation alone", () => {
    for (const key of ["ArrowUp", "Enter", "Tab", "F3", "Escape"]) {
      expect(normalizeAppShortcutInputKey(input({ code: key, key }))).toBe(key);
    }
    expect(
      normalizeAppShortcutInputKey(input({ code: "Backslash", key: "\\" })),
    ).toBe("\\");
  });

  it("resolves a shifted character to its unshifted base", () => {
    expect(
      normalizeAppShortcutInputKey(
        input({ code: "Digit1", key: "!", shiftKey: true }),
      ),
    ).toBe("1");
    expect(
      normalizeAppShortcutInputKey(
        input({ code: "Backslash", key: "|", shiftKey: true }),
      ),
    ).toBe("\\");
  });

  it("reads Space from either spelling", () => {
    expect(
      normalizeAppShortcutInputKey(input({ code: "Space", key: " " })),
    ).toBe("Space");
  });
});

describe("matchesAppShortcut", () => {
  it("matches Mod+J on a Cyrillic layout", () => {
    expect(
      matchesAppShortcut(
        input({ code: "KeyJ", key: "о", metaKey: true }),
        modShortcut("j"),
        true,
      ),
    ).toBe(true);
  });

  it("matches Mod+J on a US layout", () => {
    expect(
      matchesAppShortcut(
        input({ code: "KeyJ", key: "j", metaKey: true }),
        modShortcut("j"),
        true,
      ),
    ).toBe(true);
  });

  it("does not fire a neighbouring chord on a Cyrillic layout", () => {
    // The key labelled K types "л"; it must answer Mod+K and nothing else.
    expect(
      matchesAppShortcut(
        input({ code: "KeyK", key: "л", metaKey: true }),
        modShortcut("j"),
        true,
      ),
    ).toBe(false);
    expect(
      matchesAppShortcut(
        input({ code: "KeyK", key: "л", metaKey: true }),
        modShortcut("k"),
        true,
      ),
    ).toBe(true);
  });

  it("keeps Mod+A on the key labelled A on AZERTY", () => {
    expect(
      matchesAppShortcut(
        input({ code: "KeyQ", key: "a", metaKey: true }),
        modShortcut("a"),
        true,
      ),
    ).toBe(true);
    // The key where QWERTY puts A types "q" there, and must not steal Mod+A.
    expect(
      matchesAppShortcut(
        input({ code: "KeyA", key: "q", metaKey: true }),
        modShortcut("a"),
        true,
      ),
    ).toBe(false);
  });

  it("requires the modifier the shortcut asks for", () => {
    expect(
      matchesAppShortcut(
        input({ code: "KeyJ", key: "о" }),
        modShortcut("j"),
        true,
      ),
    ).toBe(false);
    // Mod is Control off macOS.
    expect(
      matchesAppShortcut(
        input({ code: "KeyJ", ctrlKey: true, key: "о" }),
        modShortcut("j"),
        false,
      ),
    ).toBe(true);
  });
});
