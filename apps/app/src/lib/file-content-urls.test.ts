// @vitest-environment jsdom

import { PATCHER_APP_KEY_QUERY_PARAM } from "@patcher/config/app-key";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildProjectAttachmentContentUrl,
  buildRawFilesystemHtmlContentUrl,
  buildThreadHostFileContentUrl,
  buildThreadStorageRawContentUrl,
  buildThreadWorktreeRawContentUrl,
} from "./file-content-urls";

/**
 * Which of these URLs may carry the app key, and which must not.
 *
 * The line is whether the bytes become a **document**. An `<img src>` cannot
 * read the URL it was loaded from; an HTML preview iframe renders agent-written
 * script under `sandbox="allow-scripts"` with no CSP, and that script can read
 * `location.search`. A key in one of those URLs is the whole local API handed
 * to whatever an agent happened to write into a file.
 */

const KEY = "test-app-key";

beforeEach(() => {
  sessionStorage.setItem("patcher.appKey", KEY);
});

afterEach(() => {
  sessionStorage.clear();
});

describe("URLs the browser loads as a sub-resource", () => {
  it("carry the key, because they cannot send a header", () => {
    const url = buildProjectAttachmentContentUrl("prj_1", "a.png");

    expect(
      new URLSearchParams(url.split("?")[1]).get(PATCHER_APP_KEY_QUERY_PARAM),
    ).toBe(KEY);
  });

  it("carry it on host file content too", () => {
    const url = buildThreadHostFileContentUrl("thr_1", "b.png");

    expect(url).toContain(`${PATCHER_APP_KEY_QUERY_PARAM}=${KEY}`);
  });
});

describe("URLs that become a document", () => {
  // Each of these three feeds `htmlPreviewUrl`, which the preview component
  // fetches itself and renders from a `blob:` URL. If one ever regains the
  // key, an agent-written page can read it out of its own location.
  const documentUrls = [
    ["thread storage raw", buildThreadStorageRawContentUrl("thr_1", "x.html")],
    [
      "filesystem raw html",
      buildRawFilesystemHtmlContentUrl("thr_1", "x.html"),
    ],
    ["worktree raw", buildThreadWorktreeRawContentUrl("thr_1", "x.html")],
  ] as const;

  it.each(documentUrls)("never carries the key: %s", (_name, url) => {
    expect(url).not.toContain(PATCHER_APP_KEY_QUERY_PARAM);
    expect(url).not.toContain(KEY);
  });
});
