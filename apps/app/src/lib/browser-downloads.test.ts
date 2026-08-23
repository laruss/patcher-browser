import { describe, expect, it } from "vitest";
import type { PatcherDesktopBrowserDownload } from "@patcher/desktop-contract";
import {
  acknowledgeBrowserDownloads,
  describeBrowserDownload,
  EMPTY_BROWSER_DOWNLOADS_STATE,
  MAX_LISTED_BROWSER_DOWNLOADS,
  recordBrowserDownload,
  resolveBrowserDownloadsBadge,
  type BrowserDownloadsState,
} from "./browser-downloads";

function download(
  overrides: Partial<PatcherDesktopBrowserDownload> = {},
): PatcherDesktopBrowserDownload {
  return {
    id: "download-1",
    tabId: "browser:a",
    filename: "report.pdf",
    savePath: "/Users/someone/Downloads/report.pdf",
    url: "https://example.com/report.pdf",
    mimeType: "application/pdf",
    state: "completed",
    ...overrides,
  };
}

describe("describeBrowserDownload", () => {
  // A download in flight has to stay up: it is the only thing telling the user
  // their click worked, and it is what stops them clicking again.
  it("keeps a started download's message until something replaces it", () => {
    const notice = describeBrowserDownload(download({ state: "started" }));

    expect(notice).toMatchObject({
      durationMs: null,
      title: "Downloading report.pdf",
      tone: "loading",
    });
  });

  // Same id across both events is what makes the message update in place
  // rather than stack a second one under the first.
  it("carries the download's id through every state", () => {
    for (const state of [
      "started",
      "completed",
      "cancelled",
      "interrupted",
      "refused",
    ] as const) {
      expect(describeBrowserDownload(download({ state })).id).toBe(
        "download-1",
      );
    }
  });

  it("answers the where-did-it-go question on success", () => {
    const notice = describeBrowserDownload(download({ state: "completed" }));

    expect(notice).toMatchObject({
      description: "/Users/someone/Downloads",
      title: "Downloaded report.pdf",
      tone: "success",
    });
  });

  it("reads a Windows save path as well as a posix one", () => {
    const notice = describeBrowserDownload(
      download({ savePath: "C:\\Users\\someone\\Downloads\\report.pdf" }),
    );

    expect(notice.description).toBe("C:\\Users\\someone\\Downloads");
  });

  // Three failures a user must be able to tell apart: they stopped it, the
  // network stopped it, or Patcher refused.
  it("distinguishes cancelled, interrupted and refused", () => {
    expect(describeBrowserDownload(download({ state: "cancelled" }))).toMatchObject(
      { title: "Download cancelled: report.pdf", tone: "message" },
    );
    expect(
      describeBrowserDownload(download({ state: "interrupted" })),
    ).toMatchObject({ title: "Download failed: report.pdf", tone: "error" });
    expect(
      describeBrowserDownload(download({ savePath: null, state: "refused" })),
    ).toMatchObject({
      description: "This page started too many downloads at once.",
      title: "Download blocked: report.pdf",
      tone: "warning",
    });
  });

  // The name is the shell's, already sanitized — reporting the name the page
  // asked for would describe a file that does not exist.
  it("names the file that was written", () => {
    const notice = describeBrowserDownload(
      download({
        filename: "authorized_keys",
        savePath: "/Users/someone/Downloads/authorized_keys",
      }),
    );

    expect(notice.title).toBe("Downloaded authorized_keys");
  });
});

describe("browser downloads state", () => {
  function fold(
    ...events: PatcherDesktopBrowserDownload[]
  ): BrowserDownloadsState {
    return events.reduce(recordBrowserDownload, EMPTY_BROWSER_DOWNLOADS_STATE);
  }

  // Requirement one: a browser that has downloaded nothing has no downloads
  // button, rather than one that opens an empty list.
  it("has no badge until something is downloaded", () => {
    expect(resolveBrowserDownloadsBadge(EMPTY_BROWSER_DOWNLOADS_STATE)).toBe(
      "hidden",
    );
  });

  it("reports a download in flight, then its outcome until acknowledged", () => {
    const started = fold(download({ state: "started" }));
    expect(resolveBrowserDownloadsBadge(started)).toBe("downloading");

    const finished = recordBrowserDownload(started, download());
    expect(resolveBrowserDownloadsBadge(finished)).toBe("done");

    // Clicking the button is the acknowledgement.
    expect(
      resolveBrowserDownloadsBadge(acknowledgeBrowserDownloads(finished)),
    ).toBe("idle");
  });

  it("reports a failure the same way, and keeps it until acknowledged", () => {
    const failed = fold(download({ state: "interrupted" }));
    expect(resolveBrowserDownloadsBadge(failed)).toBe("error");
    expect(
      resolveBrowserDownloadsBadge(acknowledgeBrowserDownloads(failed)),
    ).toBe("idle");
  });

  // Otherwise a background download finishing would quietly clear the only
  // sign that an earlier one failed.
  it("does not let a later success hide an unseen failure", () => {
    const state = fold(
      download({ id: "download-1", state: "interrupted" }),
      download({ id: "download-2", state: "completed" }),
    );

    expect(resolveBrowserDownloadsBadge(state)).toBe("error");
  });

  // The animation describes something still happening, so it outranks a
  // colour that is only waiting to be looked at.
  it("shows progress over an unacknowledged outcome", () => {
    const state = fold(
      download({ id: "download-1", state: "completed" }),
      download({ id: "download-2", state: "started" }),
    );

    expect(resolveBrowserDownloadsBadge(state)).toBe("downloading");
  });

  // One download is one row for its whole life: a finishing download must not
  // jump to the top of a list the user is reading.
  it("updates a download in place rather than adding a second row", () => {
    const state = fold(
      download({ id: "download-1", state: "started" }),
      download({ id: "download-2", state: "started" }),
      download({ id: "download-1", state: "completed" }),
    );

    expect(state.entries.map((entry) => entry.id)).toEqual([
      "download-2",
      "download-1",
    ]);
    expect(state.entries[1]?.outcome).toBe("done");
  });

  it("keeps the ten most recent, newest first", () => {
    const state = fold(
      ...Array.from({ length: 14 }, (_unused, index) =>
        download({ filename: `file-${index}.txt`, id: `download-${index}` }),
      ),
    );

    expect(state.entries).toHaveLength(MAX_LISTED_BROWSER_DOWNLOADS);
    expect(state.entries[0]?.id).toBe("download-13");
    expect(state.entries.at(-1)?.id).toBe("download-4");
  });

  // Cancelled, interrupted and refused differ in why nothing arrived; a row
  // has one status icon, so they collapse to one outcome.
  it("collapses every unfinished state into one failure outcome", () => {
    for (const state of ["cancelled", "interrupted", "refused"] as const) {
      expect(
        fold(download({ state })).entries[0]?.outcome,
      ).toBe("error");
    }
    expect(fold(download({ state: "completed" })).entries[0]?.outcome).toBe(
      "done",
    );
  });
});
