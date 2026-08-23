import type { MenuItemConstructorOptions } from "electron";
import type { PatcherDesktopBrowserContextMenuItem } from "@patcher/desktop-contract";

// The right-click menu for a browsed page.
//
// Built here as plain data rather than inside the view manager so the rules —
// which section shows for which target, and which of them refuse a URL — can be
// read and tested without an Electron window. Everything the menu acts on comes
// from the page, so every entry that takes a URL states what it will accept.

/** Enough of a selection to name it in a menu item without a wall of text. */
const MAX_MENU_SELECTION_LENGTH = 32;

/**
 * The only schemes any entry here will act on.
 *
 * The same rule the popup policy applies, and for the same reason: a page
 * chooses these URLs. `javascript:` in a link would otherwise become a click
 * that runs it, and `file:` would become a reader for the local disk.
 */
function isActionableUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Collapses whitespace so a multi-line selection stays one menu line. */
export function summarizeSelection(selectionText: string): string {
  const collapsed = selectionText.replace(/\s+/gu, " ").trim();
  return collapsed.length > MAX_MENU_SELECTION_LENGTH
    ? `${collapsed.slice(0, MAX_MENU_SELECTION_LENGTH)}…`
    : collapsed;
}

export interface BrowserContextMenuTarget {
  canGoBack: boolean;
  canGoForward: boolean;
  editFlags: {
    canCopy: boolean;
    canCut: boolean;
    canPaste: boolean;
    canSelectAll: boolean;
  };
  isEditable: boolean;
  /** Empty when the click was not on a link. */
  linkURL: string;
  /** Electron's media type; `"image"` is the only one this menu acts on. */
  mediaType: string;
  selectionText: string;
  /** The image's own URL, when `mediaType` is `"image"`. */
  srcURL: string;
}

export interface BrowserContextMenuActions {
  copyImage: () => void;
  /**
   * Open Chromium's DevTools on the node under the pointer. Undefined when the
   * caller cannot host them, which is what keeps the entry off a menu where it
   * would do nothing.
   */
  inspect?: () => void;
  /** Hand a picked plugin entry back to the renderer, which owns plugin calls. */
  invokePluginItem: (item: PatcherDesktopBrowserContextMenuItem) => void;
  copyText: (text: string) => void;
  goBack: () => void;
  goForward: () => void;
  openExternally: (url: string) => void;
  openInNewTab: (url: string) => void;
  reload: () => void;
  saveImage: (url: string) => void;
  searchFor: (query: string) => void;
}

export interface BuildBrowserContextMenuArgs {
  actions: BrowserContextMenuActions;
  /**
   * False when Patcher is itself the browser macOS opens links with. The entry would
   * then hand the link to Launch Services, which would hand it straight back as
   * a new tab — which is what "Open Link in New Tab" above already does, without
   * claiming to have left the app. Defaults to true, which is what every build
   * before Patcher could be a default browser did.
   */
  canOpenExternally?: boolean;
  /** Contributed by plugins; already capped by the wire schema. */
  pluginItems?: readonly PatcherDesktopBrowserContextMenuItem[];
  target: BrowserContextMenuTarget;
}

/**
 * Whether a contributed item belongs on this menu.
 *
 * `when` is a set of contexts, and any of them matching is enough — an item for
 * links and images appears on both. An item that asked for nothing appears
 * everywhere, which is the honest reading of "no condition".
 */
export function matchesContextMenuTarget(
  when: PatcherDesktopBrowserContextMenuItem["when"],
  target: BrowserContextMenuTarget,
): boolean {
  const asked = when.image || when.link || when.page || when.selection;
  if (!asked) {
    return true;
  }
  if (when.link && target.linkURL.length > 0) return true;
  if (when.image && target.mediaType === "image") return true;
  if (when.selection && target.selectionText.trim().length > 0) return true;
  return (
    when.page &&
    target.linkURL.length === 0 &&
    target.mediaType !== "image" &&
    target.selectionText.trim().length === 0
  );
}

/**
 * The menu for one right-click.
 *
 * Sections are chosen by what was clicked rather than shown together, the way
 * a browser does it: a link menu is about the link, and burying "Open link in
 * new tab" under six editing roles is how a menu stops being usable. An
 * editable field keeps the editing roles, because there the roles *are* the
 * menu.
 */
export function buildBrowserContextMenuTemplate({
  actions,
  canOpenExternally = true,
  pluginItems = [],
  target,
}: BuildBrowserContextMenuArgs): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  const hasSelection = target.selectionText.trim().length > 0;

  if (target.linkURL.length > 0) {
    const canOpen = isActionableUrl(target.linkURL);
    template.push(
      {
        label: "Open Link in New Tab",
        enabled: canOpen,
        click: () => {
          actions.openInNewTab(target.linkURL);
        },
      },
      ...(canOpenExternally
        ? [
            {
              label: "Open Link in Default Browser",
              enabled: canOpen,
              click: () => {
                actions.openExternally(target.linkURL);
              },
            },
          ]
        : []),
      {
        label: "Copy Link Address",
        click: () => {
          actions.copyText(target.linkURL);
        },
      },
    );
  }

  if (target.mediaType === "image") {
    if (template.length > 0) {
      template.push({ type: "separator" });
    }
    template.push(
      {
        label: "Copy Image",
        click: () => {
          actions.copyImage();
        },
      },
      {
        label: "Copy Image Address",
        click: () => {
          actions.copyText(target.srcURL);
        },
      },
      {
        label: "Save Image",
        // Downloading is what "save" means here, so it goes through the
        // download path and lands in the downloads folder like any other file.
        enabled: isActionableUrl(target.srcURL),
        click: () => {
          actions.saveImage(target.srcURL);
        },
      },
    );
  }

  if (target.isEditable) {
    if (template.length > 0) {
      template.push({ type: "separator" });
    }
    template.push(
      { role: "cut", enabled: target.editFlags.canCut },
      { role: "copy", enabled: target.editFlags.canCopy && hasSelection },
      { role: "paste", enabled: target.editFlags.canPaste },
      { type: "separator" },
      { role: "selectAll", enabled: target.editFlags.canSelectAll },
    );
  } else if (hasSelection) {
    if (template.length > 0) {
      template.push({ type: "separator" });
    }
    template.push(
      { role: "copy", enabled: target.editFlags.canCopy },
      {
        label: `Search for “${summarizeSelection(target.selectionText)}”`,
        click: () => {
          actions.searchFor(target.selectionText);
        },
      },
    );
  }

  // Navigation is the fallback menu: with nothing under the pointer, a
  // right-click is about the page itself.
  if (template.length === 0) {
    template.push(
      {
        label: "Back",
        enabled: target.canGoBack,
        click: () => {
          actions.goBack();
        },
      },
      {
        label: "Forward",
        enabled: target.canGoForward,
        click: () => {
          actions.goForward();
        },
      },
      {
        label: "Reload",
        click: () => {
          actions.reload();
        },
      },
      { type: "separator" },
      { role: "selectAll", enabled: target.editFlags.canSelectAll },
    );
  }

  // Last of the browser's own entries, where every browser puts it: it is about
  // the page rather than about what was clicked, so it belongs after the things
  // that are.
  if (actions.inspect !== undefined) {
    if (template.length > 0) {
      template.push({ type: "separator" });
    }
    template.push({
      label: "Inspect",
      click: () => {
        actions.inspect?.();
      },
    });
  }

  const contributed = pluginItems.filter((item) =>
    matchesContextMenuTarget(item.when, target),
  );
  if (contributed.length > 0) {
    // Below the browser's own entries and behind a separator: a plugin adds to
    // this menu, it does not get to rearrange it.
    template.push({ type: "separator" });
    for (const item of contributed) {
      template.push({
        label: item.title,
        click: () => {
          actions.invokePluginItem(item);
        },
      });
    }
  }

  return template;
}
