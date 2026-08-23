// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UrlOpenRoutingProvider } from "@/lib/url-open-routing";
import { createPatcherDesktopApi } from "@/test/patcher-desktop-test-utils";
import {
  CommunitySettingsSection,
  GITHUB_REPO_URL,
} from "./CommunitySettingsSection";

afterEach(() => {
  cleanup();
  delete window.patcherDesktop;
});

function renderSection(openInAppBrowser: ((url: string) => void) | null): void {
  render(
    <UrlOpenRoutingProvider openInAppBrowser={openInAppBrowser}>
      <CommunitySettingsSection />
    </UrlOpenRoutingProvider>,
  );
}

function installDesktop(): void {
  window.patcherDesktop = createPatcherDesktopApi({
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform: "macos",
    updateAvailable: false,
    updateDownloaded: false,
    version: "0.0.5",
  });
}

/**
 * These rows are ordinary web links, so where they open is the link
 * preference's answer to give — the same one every other link in the app
 * asks. They used to call the OS browser directly, which left the setting
 * telling only part of the truth.
 */
describe("CommunitySettingsSection", () => {
  it("opens the repository where the link preference points", () => {
    installDesktop();
    const openInAppBrowser = vi.fn();

    renderSection(openInAppBrowser);
    fireEvent.click(screen.getByRole("button", { name: "View on GitHub" }));

    expect(openInAppBrowser).toHaveBeenCalledWith(GITHUB_REPO_URL);
  });

  it("still reaches the OS browser where there is no in-app one", () => {
    const openExternal = vi.fn();
    window.open = openExternal;

    // No desktop bridge and no in-app opener: the web build, where the
    // preference is hidden because it has nothing to choose between.
    renderSection(null);
    fireEvent.click(screen.getByRole("button", { name: "View on GitHub" }));

    expect(openExternal).toHaveBeenCalledWith(
      GITHUB_REPO_URL,
      "_blank",
      "noopener,noreferrer",
    );
  });
});
