import { randomUUID } from "node:crypto";
import type { BrowserWindow, IpcMainEvent, WebContents } from "electron";

interface Source {
  contents: WebContents;
  window: BrowserWindow;
  browser: boolean;
  visible: boolean;
  documentId: string;
  live: boolean;
  protect: boolean;
}

export class SecureKeyboardController {
  private sources = new Map<number, Source>();
  private windows = new WeakSet<BrowserWindow>();
  private blockers = new Set<string>();
  private enabled = false;
  private disposed = false;

  constructor(
    private getFocusedContents: () => WebContents | null,
    private setEnabled: (enabled: boolean) => void,
  ) {}

  register(
    contents: WebContents,
    window: BrowserWindow,
    browser: boolean,
    visible = true,
  ): void {
    if (this.disposed || contents.isDestroyed() || window.isDestroyed()) return;
    const existing = this.sources.get(contents.id);
    if (existing !== undefined) {
      existing.visible = visible;
      existing.browser = browser;
      this.refresh();
      return;
    }
    const source: Source = {
      contents,
      window,
      browser,
      visible,
      documentId: randomUUID(),
      live: false,
      protect: false,
    };
    this.sources.set(contents.id, source);
    const refresh = () => this.refresh();
    if (!this.windows.has(window)) {
      this.windows.add(window);
      window.on("focus", refresh);
      window.on("blur", refresh);
      window.on("closed", refresh);
    }
    contents.on("focus", refresh);
    contents.on("blur", refresh);
    contents.on("before-input-event", refresh);
    contents.on("render-process-gone", () => this.invalidate(source));
    contents.once("destroyed", () => {
      this.sources.delete(contents.id);
      this.refresh();
    });
    this.refresh();
  }

  private invalidate(source: Source): void {
    source.documentId = randomUUID();
    source.live = false;
    source.protect = false;
    this.refresh();
  }

  private sourceFor(
    event: Pick<IpcMainEvent, "sender" | "senderFrame">,
  ): Source | undefined {
    const source = this.sources.get(event.sender.id);
    if (
      source === undefined ||
      source.contents !== event.sender ||
      event.sender.isDestroyed()
    )
      return;
    const frame = event.senderFrame;
    const main = event.sender.mainFrame;
    if (
      frame === null ||
      frame.detached ||
      frame.isDestroyed() ||
      frame.processId !== main.processId ||
      frame.routingId !== main.routingId
    )
      return;
    return source;
  }

  documentFor(
    event: Pick<IpcMainEvent, "sender" | "senderFrame">,
  ): string | null {
    if (this.disposed) return null;
    const source = this.sourceFor(event);
    if (source === undefined) return null;
    // A preload bootstrap (including BFCache restore) replaces the document.
    // Provisional navigation can be canceled while its old document stays live.
    source.documentId = randomUUID();
    source.live = true;
    source.protect = source.browser;
    this.refresh();
    return source.documentId;
  }

  report(
    event: Pick<IpcMainEvent, "sender" | "senderFrame">,
    payload: unknown,
  ): void {
    if (this.disposed || payload === null || typeof payload !== "object")
      return;
    const data = payload as Record<string, unknown>;
    const source = this.sourceFor(event);
    if (
      source === undefined ||
      !source.live ||
      data.documentId !== source.documentId ||
      typeof data.protect !== "boolean" ||
      Object.keys(data).length !== 2
    )
      return;
    source.protect = data.protect;
    this.refresh();
  }

  block(reason: string, blocked: boolean): void {
    if (blocked) this.blockers.add(reason);
    else this.blockers.delete(reason);
    this.refresh();
  }

  refresh(): void {
    const contents = this.getFocusedContents();
    const source =
      contents === null ? undefined : this.sources.get(contents.id);
    const enabled =
      !this.disposed &&
      this.blockers.size === 0 &&
      source !== undefined &&
      source.live &&
      source.visible &&
      !source.window.isDestroyed() &&
      source.window.isFocused() &&
      !source.contents.isDestroyed() &&
      !source.contents.isCrashed() &&
      source.contents.isFocused() &&
      (source.protect ||
        (source.browser &&
          source.contents.focusedFrame !== source.contents.mainFrame));
    if (enabled !== this.enabled) {
      this.enabled = enabled;
      this.setEnabled(enabled);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.sources.clear();
    this.refresh();
  }
}
