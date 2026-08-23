import { describe, expect, it } from "vitest";
import { shouldStartOnBrowserSurface } from "./browser-first-startup";

describe("browser-first startup", () => {
  it("opens the browser when the desktop app starts on Patcher's home", () => {
    expect(
      shouldStartOnBrowserSurface({ isDesktop: true, pathname: "/" }),
    ).toBe(true);
  });

  // A start anywhere else is a destination the user (or a link) chose.
  it("leaves any other starting route alone", () => {
    for (const pathname of [
      "/browser",
      "/settings",
      "/threads/thread-1",
      "/projects/project-1",
    ]) {
      expect(shouldStartOnBrowserSurface({ isDesktop: true, pathname })).toBe(
        false,
      );
    }
  });

  // The web build has no native view to put in the surface.
  it("keeps the web build on Patcher's home", () => {
    expect(
      shouldStartOnBrowserSurface({ isDesktop: false, pathname: "/" }),
    ).toBe(false);
  });
});
