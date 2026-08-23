import { describe, expect, it, vi } from "vitest";
import type { PatcherDesktopBrowserContextMenuItem } from "@patcher/desktop-contract";
import {
  buildBrowserContextMenuTemplate,
  matchesContextMenuTarget,
  summarizeSelection,
  type BrowserContextMenuActions,
  type BrowserContextMenuTarget,
} from "../src/desktop-browser-context-menu.js";

function actions(): BrowserContextMenuActions {
  return {
    copyImage: vi.fn(),
    copyText: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    invokePluginItem: vi.fn(),
    openExternally: vi.fn(),
    openInNewTab: vi.fn(),
    reload: vi.fn(),
    saveImage: vi.fn(),
    searchFor: vi.fn(),
  };
}

function target(
  overrides: Partial<BrowserContextMenuTarget> = {},
): BrowserContextMenuTarget {
  return {
    canGoBack: true,
    canGoForward: false,
    editFlags: {
      canCopy: true,
      canCut: true,
      canPaste: true,
      canSelectAll: true,
    },
    isEditable: false,
    linkURL: "",
    mediaType: "none",
    selectionText: "",
    srcURL: "",
    ...overrides,
  };
}

function labels(
  template: ReturnType<typeof buildBrowserContextMenuTemplate>,
): string[] {
  return template.flatMap((item) =>
    typeof item.label === "string" ? [item.label] : [],
  );
}

function pluginItem(
  overrides: Partial<PatcherDesktopBrowserContextMenuItem> = {},
): PatcherDesktopBrowserContextMenuItem {
  return {
    pluginId: "notes",
    itemId: "save",
    title: "Save to notes",
    when: { image: false, link: false, page: false, selection: false },
    ...overrides,
  };
}

describe("buildBrowserContextMenuTemplate", () => {
  it("offers link actions on a link", () => {
    const template = buildBrowserContextMenuTemplate({
      actions: actions(),
      target: target({ linkURL: "https://example.test/page" }),
    });

    expect(labels(template)).toEqual([
      "Open Link in New Tab",
      "Open Link in Default Browser",
      "Copy Link Address",
    ]);
  });

  it("drops the external entry when Patcher is itself the default browser", () => {
    const template = buildBrowserContextMenuTemplate({
      actions: actions(),
      canOpenExternally: false,
      target: target({ linkURL: "https://example.test/page" }),
    });

    // Not disabled but gone: handing the link to Launch Services would hand it
    // straight back as a tab, which the entry above already does honestly.
    expect(labels(template)).toEqual([
      "Open Link in New Tab",
      "Copy Link Address",
    ]);
  });

  // A page chooses these URLs, so the entries that act on one refuse anything
  // that is not a page: `javascript:` would otherwise become a click that runs
  // it, and `file:` a reader for the local disk.
  it("refuses to open a link that is not http(s)", () => {
    const template = buildBrowserContextMenuTemplate({
      actions: actions(),
      target: target({ linkURL: "javascript:alert(1)" }),
    });

    const openInTab = template.find(
      (item) => item.label === "Open Link in New Tab",
    );
    const openExternally = template.find(
      (item) => item.label === "Open Link in Default Browser",
    );
    expect(openInTab?.enabled).toBe(false);
    expect(openExternally?.enabled).toBe(false);
    // Copying the address is still fine: it goes to the clipboard, not to a
    // navigation.
    expect(labels(template)).toContain("Copy Link Address");
  });

  it("offers image actions on an image, and saving only for a real URL", () => {
    const template = buildBrowserContextMenuTemplate({
      actions: actions(),
      target: target({
        mediaType: "image",
        srcURL: "https://example.test/cat.png",
      }),
    });
    expect(labels(template)).toEqual([
      "Copy Image",
      "Copy Image Address",
      "Save Image",
    ]);

    const inlineImage = buildBrowserContextMenuTemplate({
      actions: actions(),
      target: target({
        mediaType: "image",
        srcURL: "data:image/png;base64,aa",
      }),
    });
    expect(
      inlineImage.find((item) => item.label === "Save Image")?.enabled,
    ).toBe(false);
  });

  it("offers a search on a selection, truncated to one line", () => {
    const template = buildBrowserContextMenuTemplate({
      actions: actions(),
      target: target({ selectionText: "  hello\n  world  " }),
    });

    expect(labels(template)).toEqual(["Search for “hello world”"]);
  });

  // With nothing under the pointer a right-click is about the page itself.
  it("falls back to navigation on a bare page", () => {
    const template = buildBrowserContextMenuTemplate({
      actions: actions(),
      target: target(),
    });

    expect(labels(template)).toEqual(["Back", "Forward", "Reload"]);
    expect(template.find((item) => item.label === "Forward")?.enabled).toBe(
      false,
    );
  });

  it("keeps the editing roles in an editable field", () => {
    const template = buildBrowserContextMenuTemplate({
      actions: actions(),
      target: target({ isEditable: true, selectionText: "typed" }),
    });

    expect(template.flatMap((item) => (item.role ? [item.role] : []))).toEqual([
      "cut",
      "copy",
      "paste",
      "selectAll",
    ]);
  });

  it("routes each action to its own callback", () => {
    const menuActions = actions();
    const template = buildBrowserContextMenuTemplate({
      actions: menuActions,
      target: target({ linkURL: "https://example.test/page" }),
    });

    for (const item of template) {
      item.click?.(undefined as never, undefined as never, undefined as never);
    }

    expect(menuActions.openInNewTab).toHaveBeenCalledWith(
      "https://example.test/page",
    );
    expect(menuActions.openExternally).toHaveBeenCalledWith(
      "https://example.test/page",
    );
    expect(menuActions.copyText).toHaveBeenCalledWith(
      "https://example.test/page",
    );
  });
});

describe("Inspect", () => {
  // Where every browser puts it: last of the browser's own entries, because it
  // is about the page rather than about what was clicked.
  it("comes last, and opens the tools on what was clicked", () => {
    const inspect = vi.fn();
    const template = buildBrowserContextMenuTemplate({
      actions: { ...actions(), inspect },
      target: target({ linkURL: "https://example.test/page" }),
    });

    expect(labels(template).at(-1)).toBe("Inspect");
    template
      .at(-1)
      ?.click?.(undefined as never, undefined as never, undefined as never);
    expect(inspect).toHaveBeenCalled();
  });

  // A caller that cannot host the tools must not offer an entry that does
  // nothing.
  it("stays off the menu when there is nowhere to open them", () => {
    const template = buildBrowserContextMenuTemplate({
      actions: actions(),
      target: target(),
    });

    expect(labels(template)).not.toContain("Inspect");
  });
});

describe("plugin entries on the page menu", () => {
  // Below the browser's own entries, behind a separator: a plugin adds to this
  // menu, it does not get to rearrange it.
  it("appends contributed items under the built-in ones", () => {
    const template = buildBrowserContextMenuTemplate({
      actions: actions(),
      pluginItems: [pluginItem()],
      target: target({ linkURL: "https://example.test/page" }),
    });

    expect(labels(template).at(-1)).toBe("Save to notes");
    expect(template.at(-2)?.type).toBe("separator");
  });

  it("shows an item only in the contexts it asked for", () => {
    const linkOnly = pluginItem({
      when: { image: false, link: true, page: false, selection: false },
    });

    expect(
      labels(
        buildBrowserContextMenuTemplate({
          actions: actions(),
          pluginItems: [linkOnly],
          target: target({ linkURL: "https://example.test/" }),
        }),
      ),
    ).toContain("Save to notes");
    expect(
      labels(
        buildBrowserContextMenuTemplate({
          actions: actions(),
          pluginItems: [linkOnly],
          target: target({ selectionText: "words" }),
        }),
      ),
    ).not.toContain("Save to notes");
  });

  // An editable field is the one menu that used to return early, so it is the
  // one worth pinning: a plugin item must still reach it.
  it("reaches an editable field too", () => {
    const template = buildBrowserContextMenuTemplate({
      actions: actions(),
      pluginItems: [pluginItem()],
      target: target({ isEditable: true }),
    });

    expect(labels(template)).toContain("Save to notes");
  });

  it("hands a picked item back with the item it belongs to", () => {
    const menuActions = actions();
    const item = pluginItem();
    const template = buildBrowserContextMenuTemplate({
      actions: menuActions,
      pluginItems: [item],
      target: target(),
    });

    template
      .find((candidate) => candidate.label === "Save to notes")
      ?.click?.(undefined as never, undefined as never, undefined as never);

    expect(menuActions.invokePluginItem).toHaveBeenCalledWith(item);
  });
});

describe("matchesContextMenuTarget", () => {
  it("treats an empty condition as every context", () => {
    const when = { image: false, link: false, page: false, selection: false };

    expect(matchesContextMenuTarget(when, target())).toBe(true);
    expect(
      matchesContextMenuTarget(when, target({ linkURL: "https://a.test/" })),
    ).toBe(true);
  });

  it("matches any one of several conditions", () => {
    const when = { image: true, link: true, page: false, selection: false };

    expect(matchesContextMenuTarget(when, target({ mediaType: "image" }))).toBe(
      true,
    );
    expect(matchesContextMenuTarget(when, target({ selectionText: "x" }))).toBe(
      false,
    );
  });

  // "page" is the bare right-click, so anything under the pointer excludes it.
  it("reads page as nothing under the pointer", () => {
    const when = { image: false, link: false, page: true, selection: false };

    expect(matchesContextMenuTarget(when, target())).toBe(true);
    expect(
      matchesContextMenuTarget(when, target({ linkURL: "https://a.test/" })),
    ).toBe(false);
    expect(matchesContextMenuTarget(when, target({ selectionText: "x" }))).toBe(
      false,
    );
  });
});

describe("summarizeSelection", () => {
  it("collapses whitespace and caps the length", () => {
    expect(summarizeSelection("  a\n\n b  ")).toBe("a b");
    expect(summarizeSelection("x".repeat(80))).toBe(`${"x".repeat(32)}…`);
  });
});
