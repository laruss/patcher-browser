import type { WebContentsView } from "electron";
import type {
  DesktopBrowserHostContentBounds,
  DesktopBrowserHostContentView,
  DesktopBrowserHostWebContents,
  DesktopBrowserHostWebContentsPayload,
  DesktopBrowserHostWindow,
} from "../src/desktop-browser-view.js";

/**
 * The window the view manager is handed, faked.
 *
 * Not part of the Electron mock, and that is the distinction worth keeping: the
 * manager takes its host window as an argument, so this is the *interface* it
 * was given rather than the module it imports. Nothing here needs hoisting.
 *
 * Its own module because `desktop-browser-view-manager.test.ts` is the longest
 * file in the repository and pinned at that length, so a test added to it has
 * to be paid for out of it (#80).
 */

export interface FakeHostWindowArgs {
  contentBounds: DesktopBrowserHostContentBounds;
  webContentsId: number;
}

export class FakeHostWebContents implements DesktopBrowserHostWebContents {
  public destroyed = false;
  public readonly sentPayloads: DesktopBrowserHostWebContentsPayload[] = [];
  public readonly sentMessages: Array<{
    channel: string;
    payload: DesktopBrowserHostWebContentsPayload;
  }> = [];
  readonly #id: number;

  constructor(id: number) {
    this.#id = id;
  }

  /**
   * Throws once destroyed, the way Electron's does — a plain field here is a
   * lie, and it is the lie that let a crash on window close reach a user: the
   * host's `webContents` is already gone when its child views finish closing.
   */
  get id(): number {
    if (this.destroyed) {
      throw new TypeError("Object has been destroyed");
    }
    return this.#id;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, payload: DesktopBrowserHostWebContentsPayload): void {
    this.sentPayloads.push(payload);
    this.sentMessages.push({ channel, payload });
  }
}

export class FakeContentView implements DesktopBrowserHostContentView {
  public readonly addedViews: WebContentsView[] = [];
  public readonly removedViews: WebContentsView[] = [];

  addChildView(view: WebContentsView): void {
    this.addedViews.push(view);
  }

  removeChildView(view: WebContentsView): void {
    this.removedViews.push(view);
  }
}

export class FakeHostWindow implements DesktopBrowserHostWindow {
  public contentBounds: DesktopBrowserHostContentBounds;
  public destroyed = false;
  public fullScreen = false;
  /** Every `setFullScreen` the manager asked for, in order. */
  public readonly fullScreenCalls: boolean[] = [];
  public readonly contentView = new FakeContentView();
  public readonly webContents: FakeHostWebContents;

  constructor({ contentBounds, webContentsId }: FakeHostWindowArgs) {
    this.contentBounds = contentBounds;
    this.webContents = new FakeHostWebContents(webContentsId);
  }

  getContentBounds(): DesktopBrowserHostContentBounds {
    return this.contentBounds;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isFullScreen(): boolean {
    return this.fullScreen;
  }

  setFullScreen(fullScreen: boolean): void {
    this.fullScreenCalls.push(fullScreen);
    this.fullScreen = fullScreen;
  }
}
