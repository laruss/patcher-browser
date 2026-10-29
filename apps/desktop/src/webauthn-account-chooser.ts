import {
  app,
  dialog,
  webContents,
  webFrameMain,
  type BrowserWindow,
  type SelectWebauthnAccountDetails,
  type Session,
} from "electron";
import type { EventEmitter } from "node:events";

function label(value: string): string {
  return value
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}&]/gu, " ")
    .slice(0, 100)
    .trim();
}

/** Native-only UI: the page never chooses or supplies a credential ID. */
export function registerWebAuthnAccountChooser(
  browsingSession: Session,
  resolveTarget: (
    id: number,
  ) => { window: BrowserWindow; current(): boolean } | null,
): void {
  // Keep the slot until the OS sheet has actually closed, including on cancellation.
  const pending = new Map<number, () => void>();
  let stopping = false;
  app.on("before-quit", () => {
    stopping = true;
    for (const cancel of pending.values()) cancel();
  });
  browsingSession.on("select-webauthn-account", (_event, details, callback) => {
    let finished = false;
    const cleanup: Array<() => void> = [];
    const controller = new AbortController();
    const finish = (id?: string) => {
      if (finished) return;
      finished = true;
      for (const remove of cleanup) remove();
      controller.abort();
      try {
        callback(id);
      } catch {
        /* A destroyed native ceremony can discard its callback. */
      }
    };
    const cancel = () => finish();
    try {
      const frame = details.frame;
      const contents = frame && webContents.fromFrame(frame);
      const target = contents && resolveTarget(contents.id);
      if (
        stopping ||
        !frame ||
        frame.detached ||
        !contents ||
        contents.isDestroyed() ||
        contents.session !== browsingSession ||
        !target ||
        !target.current() ||
        target.window.isDestroyed() ||
        !target.window.isVisible() ||
        target.window.isMinimized() ||
        !target.window.isFocused() ||
        pending.has(target.window.id) ||
        pending.size >= 16 ||
        !validAccounts(details)
      ) {
        cancel();
        return;
      }
      const window = target.window;
      const windowId = window.id;
      const token = frame.frameToken,
        processId = frame.processId;
      const url = frame.url,
        origin = frame.origin;
      const ancestors = new Set<Electron.WebFrameMain>();
      for (let one: Electron.WebFrameMain | null = frame; one; one = one.parent)
        ancestors.add(one);
      // Snapshot both IDs and labels: only a listed native account can be returned.
      const accounts = details.accounts.map((one, index) => ({
        id: one.credentialId,
        label: `${index + 1}. ${label(one.displayName ?? one.name ?? "Unnamed account") || "Unnamed account"}`,
      }));
      const current = () => {
        try {
          return (
            !contents.isDestroyed() &&
            !window.isDestroyed() &&
            window.isVisible() &&
            !window.isMinimized() &&
            target.current() &&
            !frame.detached &&
            frame.url === url &&
            frame.origin === origin &&
            webFrameMain.fromFrameToken(processId, token) === frame
          );
        } catch {
          return false;
        }
      };
      pending.set(windowId, cancel);
      const contentsEvents = ["render-process-gone", "destroyed"] as const;
      const navigation = (
        event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
      ) => {
        if (event.isMainFrame || (event.frame && ancestors.has(event.frame)))
          cancel();
      };
      contents.on("did-start-navigation", navigation);
      cleanup.push(() =>
        contents.removeListener("did-start-navigation", navigation),
      );
      const windowEvents = ["hide", "minimize", "closed"] as const;
      for (const event of contentsEvents) {
        (contents as EventEmitter).on(event, cancel);
        cleanup.push(() =>
          (contents as EventEmitter).removeListener(event, cancel),
        );
      }
      for (const event of windowEvents) {
        (window as EventEmitter).on(event, cancel);
        cleanup.push(() =>
          (window as EventEmitter).removeListener(event, cancel),
        );
      }
      const deadline = setTimeout(cancel, 120_000);
      // There is no WebFrameMain destruction event; also covers hidden/detached tabs.
      const poll = setInterval(() => {
        if (!current()) cancel();
      }, 250);
      cleanup.push(() => {
        clearTimeout(deadline);
        clearInterval(poll);
      });
      let result: Promise<Electron.MessageBoxReturnValue>;
      try {
        result = dialog.showMessageBox(window, {
          title: "Choose a passkey",
          type: "question",
          message: `Sign in to ${label(details.relyingPartyId)}?`,
          detail: `Requesting origin: ${origin}\nChoose an account stored on your authenticator.`,
          buttons: ["Cancel", ...accounts.map((one) => one.label)],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
          signal: controller.signal,
        });
      } catch {
        pending.delete(windowId);
        cancel();
        return;
      }
      void result
        .then((choice) => {
          const account = accounts[choice.response - 1];
          finish(current() ? account?.id : undefined);
        }, cancel)
        .finally(() => {
          pending.delete(windowId);
        });
    } catch {
      cancel();
    }
  });
}

function validAccounts(details: SelectWebauthnAccountDetails): boolean {
  return (
    typeof details.relyingPartyId === "string" &&
    /^[a-zA-Z0-9.:-]{1,253}$/u.test(details.relyingPartyId) &&
    Array.isArray(details.accounts) &&
    details.accounts.length > 0 &&
    details.accounts.length <= 8 &&
    new Set(details.accounts.map((one) => one.credentialId)).size ===
      details.accounts.length &&
    details.accounts.every(
      (one) =>
        typeof one.credentialId === "string" &&
        /^[a-zA-Z0-9_-]{1,4096}$/u.test(one.credentialId),
    )
  );
}
