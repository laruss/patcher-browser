import { describe, expect, it } from "vitest";
import { getAppKeybindingOverrides } from "@patcher/db";
import {
  BROWSER_SELECT_TAB_APP_COMMAND_IDS,
  PANE_FOCUS_APP_COMMAND_IDS,
  THREAD_JUMP_APP_COMMAND_IDS,
  applyAppKeybindingOverrides,
  appKeybindingOverridesSchema,
} from "@patcher/domain";
import { systemConfigResponseSchema } from "@patcher/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("app keybindings", () => {
  /**
   * The default keymap is a browser's, plus the handful of app chords that back
   * native menu items. Everything Patcher inherited from bb is listed but
   * unassigned — present in `defaultKeybindings` with a null shortcut so the
   * settings UI can offer it, absent from `keybindings` so it competes for no
   * chord.
   */
  it("assigns chords to the browser and to the menu-backed app commands only", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      const config = systemConfigResponseSchema.parse(await readJson(response));
      const assignedDefaultKeybindings = applyAppKeybindingOverrides(
        config.defaultKeybindings,
        [],
      );
      expect(config.keybindingOverrides).toEqual([]);
      expect(assignedDefaultKeybindings).toEqual(config.keybindings);

      // The whole non-browser keymap, exhaustively. Five of these six exist
      // because the native menu reads its accelerators from this table
      // (`resolveApplicationMenuAccelerators`), so dropping one empties a menu
      // item's shortcut; the sixth is the sidebar, which is the one panel that
      // exists on every route.
      const nonBrowser = config.keybindings.filter(
        (binding) => !binding.command.startsWith("browser."),
      );
      expect(
        nonBrowser.map((binding) => ({
          command: binding.command,
          key: binding.shortcut.key,
          mod: binding.shortcut.mod,
          shift: binding.shortcut.shift,
          desktopOnly: binding.desktopOnly,
        })),
      ).toEqual([
        {
          command: "thread.new",
          key: "o",
          mod: true,
          shift: true,
          desktopOnly: false,
        },
        {
          command: "settings.open",
          key: ",",
          mod: true,
          shift: false,
          desktopOnly: false,
        },
        {
          command: "sidebar.toggle",
          key: "j",
          mod: true,
          shift: false,
          desktopOnly: false,
        },
        // The browser-focus copy, so the chord survives a key pressed inside a
        // browsed page — the shell resolves those and only looks at bindings
        // whose context names `browserFocus`.
        {
          command: "sidebar.toggle",
          key: "j",
          mod: true,
          shift: false,
          desktopOnly: true,
        },
        {
          command: "panel.newTab",
          key: "t",
          mod: true,
          shift: false,
          desktopOnly: false,
        },
        {
          command: "panel.close",
          key: "w",
          mod: true,
          shift: false,
          desktopOnly: false,
        },
        {
          command: "window.new",
          key: "n",
          mod: true,
          shift: false,
          desktopOnly: true,
        },
      ]);

      // The inherited set: listed, assignable, and holding no chord.
      const inherited = [
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
        "panel.toggle",
        "diff.toggle",
        "terminal.open",
        "composer.focus",
        "modelPicker.toggle",
        "modelPicker.cycleModel",
        "modelPicker.cycleReasoning",
        "workspace.openPreferred",
      ] as const;
      for (const command of inherited) {
        expect(
          config.defaultKeybindings.find(
            (binding) => binding.command === command,
          ),
        ).toMatchObject({ shortcut: null });
        expect(
          config.keybindings.some((binding) => binding.command === command),
        ).toBe(false);
      }

      // Mod+Shift+N stays unassigned on purpose — it is the incognito window
      // everywhere else, and Patcher has yet to build one.
      expect(
        config.keybindings.filter(
          (binding) =>
            binding.shortcut.key === "n" &&
            binding.shortcut.mod &&
            binding.shortcut.shift,
        ),
      ).toEqual([]);

      // Mod+P is print and nothing else.
      const modP = config.keybindings.filter(
        (binding) =>
          binding.shortcut.key === "p" &&
          binding.shortcut.mod &&
          !binding.shortcut.shift,
      );
      expect(modP.map((binding) => binding.command)).toEqual(["browser.print"]);
      expect(modP[0]?.when).toMatchObject({
        all: expect.arrayContaining(["browserFocus"]),
      });

      // Nothing holds plain Alt any more: the model-picker cycle chords were
      // the only ones, and they went with the rest of the inherited set.
      expect(
        config.keybindings.filter(
          (binding) =>
            binding.shortcut.alt &&
            !binding.shortcut.mod &&
            !binding.shortcut.control &&
            !binding.shortcut.meta,
        ),
      ).toEqual([]);

      expect(
        assignedDefaultKeybindings
          .filter((binding) => binding.desktopOnly)
          .map((binding) => binding.command),
      ).toEqual([
        "sidebar.toggle",
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
        "window.new",
      ]);
    });
  });

  it("persists command overrides and resolves every scoped binding", async () => {
    await withTestHarness(async (harness) => {
      const shortcut = {
        key: "u",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: true,
      };
      const overrides = [
        { command: "thread.new" as const, shortcut },
        // Two bindings, one command: the sidebar toggle has a main-surface entry
        // and a browser-focus copy, so this is what proves an override reaches
        // every binding rather than only the first.
        { command: "sidebar.toggle" as const, shortcut },
      ];
      const response = await harness.app.request("/api/v1/settings/keyboard", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(overrides),
      });
      expect(response.status).toBe(200);
      expect(
        appKeybindingOverridesSchema.parse(await readJson(response)),
      ).toEqual(overrides);
      expect(getAppKeybindingOverrides(harness.db)).toEqual(overrides);

      const configResponse = await harness.app.request("/api/v1/system/config");
      const config = systemConfigResponseSchema.parse(
        await readJson(configResponse),
      );
      expect(config.keybindingOverrides).toEqual(overrides);
      expect(
        config.keybindings.find((binding) => binding.command === "thread.new"),
      ).toMatchObject({ shortcut });
      expect(
        config.keybindings.filter(
          (binding) => binding.command === "sidebar.toggle",
        ),
      ).toHaveLength(2);
      expect(
        config.keybindings
          .filter((binding) => binding.command === "sidebar.toggle")
          .every((binding) => binding.shortcut.key === "u"),
      ).toBe(true);
    });
  });

  it("activates an assignable command without a default shortcut", async () => {
    await withTestHarness(async (harness) => {
      const shortcut = {
        key: "r",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: true,
      };
      const response = await harness.app.request("/api/v1/settings/keyboard", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ command: "thread.rename", shortcut }]),
      });
      expect(response.status).toBe(200);

      const configResponse = await harness.app.request("/api/v1/system/config");
      const config = systemConfigResponseSchema.parse(
        await readJson(configResponse),
      );
      expect(
        config.keybindings.filter(
          (binding) => binding.command === "thread.rename",
        ),
      ).toEqual([
        {
          command: "thread.rename",
          desktopOnly: false,
          shortcut,
          when: { all: ["mainSurface"], none: ["modalOpen"] },
        },
      ]);
    });
  });

  it("activates the archive command after assigning a shortcut", async () => {
    await withTestHarness(async (harness) => {
      const shortcut = {
        key: "a",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: true,
      };
      const response = await harness.app.request("/api/v1/settings/keyboard", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ command: "thread.archive", shortcut }]),
      });
      expect(response.status).toBe(200);

      const configResponse = await harness.app.request("/api/v1/system/config");
      const config = systemConfigResponseSchema.parse(
        await readJson(configResponse),
      );
      expect(
        config.keybindings.filter(
          (binding) => binding.command === "thread.archive",
        ),
      ).toEqual([
        {
          command: "thread.archive",
          desktopOnly: false,
          shortcut,
          when: { all: ["mainSurface"], none: ["modalOpen"] },
        },
      ]);
    });
  });

  it("uses null overrides to disable a command", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/settings/keyboard", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ command: "panel.newTab", shortcut: null }]),
      });
      expect(response.status).toBe(200);

      const configResponse = await harness.app.request("/api/v1/system/config");
      const config = systemConfigResponseSchema.parse(
        await readJson(configResponse),
      );
      expect(
        config.keybindings.some(
          (binding) => binding.command === "panel.newTab",
        ),
      ).toBe(false);
      expect(
        config.defaultKeybindings.some(
          (binding) => binding.command === "panel.newTab",
        ),
      ).toBe(true);
    });
  });

  it("rejects duplicate command overrides", async () => {
    await withTestHarness(async (harness) => {
      const shortcut = {
        key: "n",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      };
      const response = await harness.app.request("/api/v1/settings/keyboard", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { command: "thread.new", shortcut },
          { command: "thread.new", shortcut },
        ]),
      });
      expect(response.status).toBe(400);
    });
  });

  it("falls back to defaults when stored overrides are corrupt", async () => {
    await withTestHarness(async (harness) => {
      harness.db.$client
        .prepare(
          "INSERT INTO app_settings (id, caffeinate, keybinding_overrides, updated_at) VALUES (?, ?, ?, ?)",
        )
        .run("current", 0, "not-json", Date.now());

      const response = await harness.app.request("/api/v1/system/config");
      expect(response.status).toBe(200);
      const config = systemConfigResponseSchema.parse(await readJson(response));
      expect(config.keybindingOverrides).toEqual([]);
      expect(config.keybindings).toEqual(
        applyAppKeybindingOverrides(config.defaultKeybindings, []),
      );
    });
  });
});
