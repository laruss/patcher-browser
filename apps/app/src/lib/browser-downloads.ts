import { useCallback, useEffect } from "react";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import type {
  PatcherDesktopBrowserDownload,
  PatcherDesktopBrowserDownloadState,
} from "@patcher/desktop-contract";
import { appToast, type AppToastTone } from "@/components/ui/app-toast";
import { reportPluginBrowserDownload } from "@/hooks/queries/plugin-contribution-queries";
import { getDesktopBrowserApi } from "./patcher-desktop";

// Downloads, as the browser surface shows them: a toolbar button that appears
// once something has been downloaded, and the list behind it.
//
// State is deliberately in memory only. That is what makes the button absent on
// a fresh launch rather than showing a history the user cannot act on — a
// restarted app has no live downloads, and the files are in the downloads
// folder either way. Persisting the list is a different feature, with storage
// and pruning of its own.

/** Long enough to read a filename, short enough not to sit over the page. */
const DOWNLOAD_TOAST_DURATION_MS = 6_000;

/** What the list shows, and therefore all it needs to remember. */
export const MAX_LISTED_BROWSER_DOWNLOADS = 10;

/**
 * The two outcomes the list distinguishes, plus the one in flight. Cancelled,
 * interrupted and refused all read as `error`: they differ in why nothing
 * arrived, and a row has one status icon.
 */
export type BrowserDownloadOutcome = "pending" | "done" | "error";

export interface BrowserDownloadEntry {
  filename: string;
  id: string;
  outcome: BrowserDownloadOutcome;
  /** Null when nothing was written, which is what disables the row's actions. */
  savePath: string | null;
}

/** What the button is asking for attention about, until the user opens the list. */
export type BrowserDownloadsUnseen = "none" | "done" | "error";

export interface BrowserDownloadsState {
  /** Newest first, capped at {@link MAX_LISTED_BROWSER_DOWNLOADS}. */
  entries: readonly BrowserDownloadEntry[];
  unseen: BrowserDownloadsUnseen;
}

export const EMPTY_BROWSER_DOWNLOADS_STATE: BrowserDownloadsState = {
  entries: [],
  unseen: "none",
};

export function browserDownloadOutcome(
  state: PatcherDesktopBrowserDownloadState,
): BrowserDownloadOutcome {
  if (state === "started") return "pending";
  return state === "completed" ? "done" : "error";
}

/**
 * Fold one download event into the list.
 *
 * A download is one row for its whole life: the `started` event creates it and
 * the terminal event updates it **in place**, so a finishing download does not
 * jump to the top of a list the user is reading.
 */
export function recordBrowserDownload(
  state: BrowserDownloadsState,
  download: PatcherDesktopBrowserDownload,
): BrowserDownloadsState {
  const outcome = browserDownloadOutcome(download.state);
  const entry: BrowserDownloadEntry = {
    filename: download.filename,
    id: download.id,
    outcome,
    savePath: download.savePath,
  };
  const index = state.entries.findIndex(
    (candidate) => candidate.id === download.id,
  );
  const entries =
    index === -1
      ? [entry, ...state.entries].slice(0, MAX_LISTED_BROWSER_DOWNLOADS)
      : state.entries.map((candidate, at) => (at === index ? entry : candidate));
  return { entries, unseen: nextUnseen(state.unseen, outcome) };
}

/**
 * An unseen failure outranks a later success, and nothing outranks either until
 * the user looks. Otherwise one background download finishing would clear the
 * only sign that an earlier one failed.
 */
function nextUnseen(
  current: BrowserDownloadsUnseen,
  outcome: BrowserDownloadOutcome,
): BrowserDownloadsUnseen {
  if (outcome === "pending") return current;
  if (outcome === "error") return "error";
  return current === "error" ? "error" : "done";
}

export function acknowledgeBrowserDownloads(
  state: BrowserDownloadsState,
): BrowserDownloadsState {
  return state.unseen === "none" ? state : { ...state, unseen: "none" };
}

/** `hidden` is the launch state: nothing downloaded, so no button at all. */
export type BrowserDownloadsBadge =
  | "hidden"
  | "idle"
  | "downloading"
  | "done"
  | "error";

export function resolveBrowserDownloadsBadge(
  state: BrowserDownloadsState,
): BrowserDownloadsBadge {
  if (state.entries.length === 0) return "hidden";
  // A download in flight outranks an unseen outcome: it is the one state that
  // is still changing, and the animation is the only progress signal there is.
  if (state.entries.some((entry) => entry.outcome === "pending")) {
    return "downloading";
  }
  if (state.unseen === "error") return "error";
  return state.unseen === "done" ? "done" : "idle";
}

/**
 * Module-scoped so the reporter (mounted above the router) and the browser
 * chrome (mounted under it) are looking at one list.
 */
const browserDownloadsAtom = atom<BrowserDownloadsState>(
  EMPTY_BROWSER_DOWNLOADS_STATE,
);

export function useBrowserDownloads(): BrowserDownloadsState {
  return useAtomValue(browserDownloadsAtom);
}

export function useAcknowledgeBrowserDownloads(): () => void {
  const setState = useSetAtom(browserDownloadsAtom);
  return useCallback(() => {
    setState(acknowledgeBrowserDownloads);
  }, [setState]);
}

export interface BrowserDownloadActions {
  openDownload: (entry: BrowserDownloadEntry) => void;
  revealDownload: (entry: BrowserDownloadEntry) => void;
}

/**
 * Opening a download, and showing it in the file manager.
 *
 * Only the shell can do either, and it refuses any path it did not write. The
 * failure worth reporting is the ordinary one — the user moved or deleted the
 * file after downloading it — so a refusal surfaces as a toast rather than
 * silently doing nothing.
 */
export function useBrowserDownloadActions(): BrowserDownloadActions {
  const run = useCallback(
    (action: "open" | "reveal", entry: BrowserDownloadEntry) => {
      const browserApi = getDesktopBrowserApi();
      if (entry.savePath === null || browserApi?.downloadAction === undefined) {
        return;
      }
      void browserApi
        .downloadAction({ action, savePath: entry.savePath })
        .then((result) => {
          if (result.ok) return;
          appToast.error(
            action === "open"
              ? `Could not open ${entry.filename}`
              : `Could not show ${entry.filename}`,
            { description: result.message },
          );
        });
    },
    [],
  );
  const openDownload = useCallback(
    (entry: BrowserDownloadEntry) => {
      run("open", entry);
    },
    [run],
  );
  const revealDownload = useCallback(
    (entry: BrowserDownloadEntry) => {
      run("reveal", entry);
    },
    [run],
  );
  return { openDownload, revealDownload };
}

export interface BrowserDownloadNotice {
  description: string | null;
  /** Sonner replaces a toast that reuses an id, so a download updates in place. */
  id: string;
  /** Only a finished download auto-dismisses; one in flight stays up. */
  durationMs: number | null;
  title: string;
  tone: AppToastTone;
}

/**
 * The directory part of a save path, for the "where did it go" half of the
 * message. Split on both separators: the renderer does not know which platform
 * the shell is on, and it must never guess wrong in a message about a file.
 */
function downloadDirectory(savePath: string): string | null {
  const separator = Math.max(
    savePath.lastIndexOf("/"),
    savePath.lastIndexOf("\\"),
  );
  return separator <= 0 ? null : savePath.slice(0, separator);
}

/**
 * What to say about a download. Pure, so the wording for every state is
 * testable without a toast library or a desktop shell.
 *
 * The filename is the shell's — sanitized, and the one actually written — not
 * the name the page asked for. Saying "Downloaded x" while a file called `y`
 * appeared would be worse than saying nothing.
 */
export function describeBrowserDownload(
  download: PatcherDesktopBrowserDownload,
): BrowserDownloadNotice {
  const notice = { description: null as string | null, id: download.id };
  const state: PatcherDesktopBrowserDownloadState = download.state;
  switch (state) {
    case "started":
      return {
        ...notice,
        // No progress: the shell reports a download starting and finishing and
        // nothing in between, so a determinate bar would be a lie. What this
        // has to do is stop the user clicking the link again.
        durationMs: null,
        title: `Downloading ${download.filename}`,
        tone: "loading",
      };
    case "completed":
      return {
        ...notice,
        description:
          download.savePath === null
            ? null
            : (downloadDirectory(download.savePath) ?? null),
        durationMs: DOWNLOAD_TOAST_DURATION_MS,
        title: `Downloaded ${download.filename}`,
        tone: "success",
      };
    case "cancelled":
      return {
        ...notice,
        durationMs: DOWNLOAD_TOAST_DURATION_MS,
        title: `Download cancelled: ${download.filename}`,
        tone: "message",
      };
    case "interrupted":
      return {
        ...notice,
        description: "The transfer stopped before the file was complete.",
        durationMs: DOWNLOAD_TOAST_DURATION_MS,
        title: `Download failed: ${download.filename}`,
        tone: "error",
      };
    case "refused":
      return {
        ...notice,
        description: "This page started too many downloads at once.",
        durationMs: DOWNLOAD_TOAST_DURATION_MS,
        title: `Download blocked: ${download.filename}`,
        tone: "warning",
      };
  }
}

function showBrowserDownloadNotice(notice: BrowserDownloadNotice): void {
  const options = {
    description: notice.description ?? undefined,
    // `Infinity` is sonner's "until something replaces it", which is exactly
    // the contract here: every `started` is followed by a terminal event.
    duration: notice.durationMs ?? Infinity,
    id: notice.id,
  };
  switch (notice.tone) {
    case "loading":
      appToast.loading(notice.title, options);
      return;
    case "success":
      appToast.success(notice.title, options);
      return;
    case "warning":
      appToast.warning(notice.title, options);
      return;
    case "error":
      appToast.error(notice.title, options);
      return;
    case "message":
      appToast.message(notice.title, options);
      return;
  }
}

/**
 * Report downloads for as long as the app is running.
 *
 * Mounted above the router, like the agent browser bridge and for the same
 * reason: a download outlives the route that started it. The user clicks a link
 * on `/browser`, walks over to a thread, and the file still lands — so the
 * thing that says so cannot be scoped to the browser surface.
 *
 * Feature-detected: a desktop shell that predates downloads has no channel, and
 * that shell refuses every download anyway, so there is nothing to miss.
 */
export function useBrowserDownloadNotifications(): void {
  const [, setDownloads] = useAtom(browserDownloadsAtom);
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.onDownload === undefined) {
      return;
    }
    return browserApi.onDownload((download) => {
      setDownloads((current) => recordBrowserDownload(current, download));
      showBrowserDownloadNotice(describeBrowserDownload(download));
      if (download.state !== "started") {
        // Hand the finished download to any plugin that registered a handler.
        // Terminal states only: a handler that moved a half-written file would
        // truncate the download it was trying to help with.
        void reportPluginBrowserDownload({
          filename: download.filename,
          id: download.id,
          mimeType: download.mimeType,
          savePath: download.savePath,
          state: download.state,
          tabId: download.tabId,
          url: download.url,
        });
      }
    });
  }, [setDownloads]);
}
