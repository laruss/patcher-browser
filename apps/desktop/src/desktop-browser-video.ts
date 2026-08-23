/**
 * The buffer behind `video-start` … `video-stop`.
 *
 * Chromium's screencast is a firehose with a hard rule attached: every frame it
 * sends must be acknowledged or it stops sending. So the pacing cannot be done
 * by ignoring frames — they are all acknowledged, and this decides which ones
 * are worth keeping. Everything below is arithmetic over that decision, kept
 * here rather than in the view manager so it can be tested without Electron.
 *
 * The budgets are not defensive: frames arrive at the page's paint rate for as
 * long as the recording runs, so an unbounded buffer is a page-controlled
 * allocation in the main process — the same reason the console and network logs
 * are rings.
 */

import {
  PATCHER_DESKTOP_BROWSER_MAX_CHAPTER_TITLE_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_VIDEO_BASE64_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_VIDEO_CHAPTERS,
  PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FRAMES,
  PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FRAME_BASE64_LENGTH,
  type PatcherDesktopBrowserVideoFrame,
} from "@patcher/desktop-contract";

/**
 * What the screencast is asked for. Not caller-settable, deliberately: a knob
 * here is a knob on how fast the buffer fills, and the one thing a caller has a
 * real opinion about — how many frames per second end up in the file — is
 * already the `fps` it passes.
 */
export const PATCHER_BROWSER_SCREENCAST_QUALITY = 50;
export const PATCHER_BROWSER_SCREENCAST_MAX_WIDTH = 960;
export const PATCHER_BROWSER_SCREENCAST_MAX_HEIGHT = 960;

export interface BrowserVideoResult {
  frames: PatcherDesktopBrowserVideoFrame[];
  chapters: { at: number; title: string }[];
  droppedFrames: number;
  durationMs: number;
}

export class BrowserVideoRecording {
  private readonly frames: PatcherDesktopBrowserVideoFrame[] = [];
  private readonly chapters: { at: number; title: string }[] = [];
  private readonly intervalMs: number;
  private totalBase64Length = 0;
  private droppedFrames = 0;
  private lastKeptAt: number | null = null;

  constructor(
    private readonly startedAt: number,
    fps: number,
  ) {
    this.intervalMs = Math.floor(1000 / fps);
  }

  /**
   * Offer a frame the screencast just delivered. Whether it is kept is this
   * object's business; acknowledging it is the caller's, and unconditional.
   */
  offerFrame(base64: string, now: number): void {
    const since = this.lastKeptAt === null ? Infinity : now - this.lastKeptAt;
    if (
      since < this.intervalMs ||
      base64.length > PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FRAME_BASE64_LENGTH ||
      this.frames.length >= PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FRAMES ||
      this.totalBase64Length + base64.length >
        PATCHER_DESKTOP_BROWSER_MAX_VIDEO_BASE64_LENGTH
    ) {
      this.droppedFrames += 1;
      return;
    }
    this.lastKeptAt = now;
    this.totalBase64Length += base64.length;
    this.frames.push({ at: this.elapsed(now), base64 });
  }

  chapter(title: string, now: number): void {
    if (this.chapters.length >= PATCHER_DESKTOP_BROWSER_MAX_VIDEO_CHAPTERS) {
      return;
    }
    this.chapters.push({
      at: this.elapsed(now),
      title: title.slice(0, PATCHER_DESKTOP_BROWSER_MAX_CHAPTER_TITLE_LENGTH),
    });
  }

  finish(now: number): BrowserVideoResult {
    return {
      frames: [...this.frames],
      chapters: [...this.chapters],
      droppedFrames: this.droppedFrames,
      durationMs: this.elapsed(now),
    };
  }

  private elapsed(now: number): number {
    // A clock that went backwards must not produce a negative stamp: these are
    // written into a manifest an encoder reads in order.
    return Math.max(0, Math.round(now - this.startedAt));
  }
}
