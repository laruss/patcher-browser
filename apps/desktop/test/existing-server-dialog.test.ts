import { describe, expect, it } from "vitest";
import { EXISTING_SERVER_DIALOG_CHOICES } from "../src/existing-server-dialog-ipc.js";
import {
  formatStartedAt,
  formatSurface,
  renderExistingServerDialogHtml,
} from "../src/existing-server-dialog.js";

const NOW = new Date("2026-08-03T12:00:00.000Z");

const DETAILS = {
  dataDir: "/Users/example/.patcher",
  entryPath: "/opt/patcher/patcher-app.js",
  pid: 4_242,
  startedAt: "2026-08-03T11:30:00.000Z",
  surface: "web",
  version: "0.34.0",
};

describe("formatStartedAt", () => {
  it("describes how long ago Patcher started", () => {
    expect(formatStartedAt("2026-08-03T11:59:30.000Z", NOW)).toBe("just now");
    expect(formatStartedAt("2026-08-03T11:30:00.000Z", NOW)).toBe("30 min ago");
    expect(formatStartedAt("2026-08-03T04:00:00.000Z", NOW)).toBe("8 h ago");
    expect(formatStartedAt("2026-07-31T12:00:00.000Z", NOW)).toBe("3 d ago");
  });

  it("falls back to the raw value it cannot parse", () => {
    expect(formatStartedAt("not-a-date", NOW)).toBe("not-a-date");
  });
});

describe("formatSurface", () => {
  it("names how Patcher was started", () => {
    expect(formatSurface("desktop")).toBe("the Patcher desktop app");
    expect(formatSurface("web")).toBe("a terminal");
  });
});

describe("renderExistingServerDialogHtml", () => {
  it("renders a button for every choice the preload wires up", () => {
    const html = renderExistingServerDialogHtml({
      details: DETAILS,
      now: NOW,
      serverUrl: "http://127.0.0.1:38986",
    });

    for (const choice of EXISTING_SERVER_DIALOG_CHOICES) {
      expect(html).toContain(`data-choice="${choice}"`);
    }
    expect(html).toContain(">Quit this Patcher<");
    expect(html).toContain(">Quit other Patcher<");
    expect(html).toContain(">Connect<");
  });

  it("describes the running Patcher", () => {
    const html = renderExistingServerDialogHtml({
      details: DETAILS,
      now: NOW,
      serverUrl: "http://127.0.0.1:38986",
    });

    expect(html).toContain("http://127.0.0.1:38986");
    expect(html).toContain("/Users/example/.patcher");
    expect(html).toContain("0.34.0");
    expect(html).toContain("30 min ago by a terminal (pid 4242)");
  });

  it("hides the stop option for a Patcher that cannot be identified", () => {
    const html = renderExistingServerDialogHtml({
      details: null,
      now: NOW,
      serverUrl: "http://127.0.0.1:38986",
    });

    expect(html).toContain('data-choice="connect"');
    expect(html).toContain('data-choice="quit"');
    expect(html).not.toContain('data-choice="replace"');
    // The warning only makes sense next to a stop button.
    expect(html).not.toContain("agent threads stop too");
  });

  it("escapes values that come from the running Patcher", () => {
    const html = renderExistingServerDialogHtml({
      details: { ...DETAILS, dataDir: '/tmp/<img src=x onerror="boom">' },
      now: NOW,
      serverUrl: "http://127.0.0.1:38986",
    });

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
