import {
  BrowserWindow,
  dialog,
  ipcMain,
  type WebContents,
  type IpcMainInvokeEvent,
} from "electron";
import { z } from "zod";
import type { PasswordManager } from "./password-manager.js";
import type { DesktopBrowserViewManager } from "./desktop-browser-view.js";
import {
  PASSWORD_PAGE_SESSION,
  PASSWORD_PAGE_CAPTURE,
  PASSWORD_PAGE_CHANNEL,
  PASSWORD_PAGE_CHANGED,
} from "./password-manager-page-ipc.js";
import { showPasswordSaveBubble } from "./password-manager-save-bubble.js";

const document = { documentId: z.string().optional() };
const inputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...document,
      kind: z.literal("accounts"),
      hasPasswordForm: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...document,
      kind: z.literal("fill"),
      fieldToken: z.string().regex(/^[a-f0-9]{32}$/u),
      id: z.uuid(),
      version: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ...document,
      kind: z.literal("capture"),
      username: z.string().max(1024),
      password: z.string().min(1).max(4096),
      submitted: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...document,
      kind: z.literal("username"),
      username: z.string().max(1024),
    })
    .strict(),
  z.object({ ...document, kind: z.enum(["success", "failure"]) }).strict(),
]);
type Draft = {
  origin: string;
  documentId: string;
  username: string;
  password: string;
  expires: number;
  capturedAt: number;
  url: string;
  ajaxSucceeded?: boolean;
  sameDocumentNavigation?: boolean;
};
export function registerPasswordManagerBrowser(args: {
  manager: PasswordManager;
  browser(): DesktopBrowserViewManager | null;
  canPrompt?(window: BrowserWindow): boolean;
}) {
  const drafts = new Map<number, Draft>();
  const usernames = new Map<
    number,
    { origin: string; value: string; expires: number }
  >();
  const observed = new Set<WebContents>();
  const prompts = new Map<number, AbortController>();
  const failures = new Set<number>();
  const ajax = new Map<number, Set<string>>();
  const waitingSuccess = new Set<number>();
  const successfulAjax = new Map<number, Set<string>>();
  const mainFrames = new Map<number, string>();
  function discard(id: number) {
    drafts.delete(id);
    ajax.delete(id);
    waitingSuccess.delete(id);
    successfulAjax.delete(id);
    prompts.get(id)?.abort();
  }
  function reset() {
    drafts.clear();
    usernames.clear();
    ajax.clear();
    waitingSuccess.clear();
    successfulAjax.clear();
    for (const prompt of prompts.values()) prompt.abort();
    prompts.clear();
  }
  function observe(contents: WebContents) {
    if (observed.has(contents)) return;
    observed.add(contents);
    contents.on("did-start-navigation", (event, _url, inPlace, mainFrame) => {
      if (mainFrame) {
        prompts.get(contents.id)?.abort();
        failures.delete(contents.id);
        if (!inPlace) {
          if (event.initiator === null) discard(contents.id);
          ajax.delete(contents.id);
          waitingSuccess.delete(contents.id);
        }
      }
    });
    contents.on("did-navigate", (_event, _url, code) => {
      if (code >= 400) failures.add(contents.id);
    });
    contents.on(
      "did-fail-load",
      (_event, _code, _description, _url, mainFrame) => {
        if (mainFrame) {
          failures.add(contents.id);
          drafts.delete(contents.id);
        }
      },
    );
    contents.once("destroyed", () => {
      drafts.delete(contents.id);
      usernames.delete(contents.id);
      failures.delete(contents.id);
      prompts.get(contents.id)?.abort();
      prompts.delete(contents.id);
      observed.delete(contents);
      ajax.delete(contents.id);
      waitingSuccess.delete(contents.id);
      successfulAjax.delete(contents.id);
      mainFrames.delete(contents.id);
    });
    contents.on("did-navigate-in-page", (_event, url, mainFrame) => {
      const draft = drafts.get(contents.id);
      if (mainFrame && draft && url !== draft.url) {
        draft.sameDocumentNavigation = true;
        contents.send(PASSWORD_PAGE_CHANGED);
        void propose(contents.id);
      }
    });
    contents.debugger.on("message", (_event, method, params) => {
      const id = contents.id,
        draft = drafts.get(id);
      if (!draft) return;
      if (
        method === "Page.frameRequestedNavigation" &&
        params.frameId === mainFrames.get(id) &&
        params.reason === "anchorClick"
      ) {
        discard(id);
        return;
      }
      if (
        method === "Network.requestWillBeSent" &&
        params.frameId === mainFrames.get(id) &&
        (params.type === "XHR" || params.type === "Fetch")
      ) {
        const requests = ajax.get(id) ?? new Set<string>();
        if (requests.size >= 128) {
          discard(id);
          return;
        }
        requests.add(params.requestId);
        ajax.set(id, requests);
      }
      const requests = ajax.get(id);
      if (!requests?.has(params.requestId)) return;
      const success = successfulAjax.get(id) ?? new Set<string>();
      if (
        method === "Network.responseReceived" &&
        params.response?.status >= 200 &&
        params.response.status < 400
      ) {
        success.add(params.requestId);
        successfulAjax.set(id, success);
      }
      if (
        method === "Network.loadingFinished" ||
        method === "Network.loadingFailed"
      ) {
        requests.delete(params.requestId);
        if (
          method === "Network.loadingFinished" &&
          success.has(params.requestId)
        ) {
          draft.ajaxSucceeded = true;
          if (waitingSuccess.has(id))
            setTimeout(() => {
              void propose(id);
            }, 250);
        }
        success.delete(params.requestId);
      }
    });
  }
  async function propose(id: number) {
    const draft = drafts.get(id),
      target = args.browser()?.passwordTarget(id);
    if (
      !draft ||
      !target ||
      prompts.has(id) ||
      failures.has(id) ||
      draft.expires < Date.now() ||
      !target.visible()
    )
      return;
    // Chromium infers same-document submissions from successful AJAX or a
    // same-document navigation plus form disappearance, not global network idle.
    if (
      draft.documentId === target.context.documentId &&
      !draft.ajaxSucceeded &&
      !draft.sameDocumentNavigation
    ) {
      waitingSuccess.add(id);
      return;
    }
    const controller = new AbortController();
    prompts.set(id, controller);
    const parent = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.id === target.hostWebContentsId,
    );
    const current = () =>
      !controller.signal.aborted &&
      args.browser()?.passwordTarget(id)?.visible() === true &&
      target.current()?.documentId === target.context.documentId;
    let accepted = false;
    try {
      if (
        !parent ||
        !(args.canPrompt?.(parent) ?? parent.isFocused()) ||
        !current()
      )
        return;
      const entries = await args.manager.forSite(draft.origin);
      const existing = entries.find(
        (entry) => entry.username === draft.username,
      );
      if (
        existing &&
        (await args.manager.password(existing, current)) === draft.password
      )
        return;
      if (!current()) return;
      // A form may vanish during an AJAX spinner or an error rerender.
      if (draft.documentId === target.context.documentId) {
        const hasForm = await target.credentials
          ?.execute(`(() => [...document.querySelectorAll('input[type="password"]')].some(input => {
          if (!input.getClientRects().length) return false;
          for (let node = input; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (node.hidden || node.inert || style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
          }
          return true;
        }))()`);
        if (hasForm === true) return;
        if (hasForm !== false || !current()) return;
      }
      drafts.delete(id);
      waitingSuccess.delete(id);
      successfulAjax.delete(id);
      accepted = await showPasswordSaveBubble({
        parent,
        ...draft,
        update: !!existing,
        signal: controller.signal,
      });
      if (!accepted || !current()) return;
      await args.manager.saveFromSite(
        draft.origin,
        draft.username,
        draft.password,
        existing,
        current,
      );
    } catch {
      if (accepted && current() && parent && !parent.isDestroyed())
        await dialog.showMessageBox(parent, {
          type: "error",
          title: "Password Manager",
          message: "Your password was not saved",
          detail:
            "The saved login changed or the vault became unavailable. Try signing in again.",
          buttons: ["OK"],
        });
    } finally {
      if (prompts.get(id) === controller) prompts.delete(id);
    }
  }
  function capture(
    event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">,
    input: unknown,
  ) {
    const parsed = inputSchema.safeParse(input),
      target = args.browser()?.passwordTarget(event.sender.id);
    if (
      !parsed.success ||
      !target ||
      event.senderFrame !== event.sender.mainFrame
    )
      return;
    const request = parsed.data,
      context = target.context;
    if (request.documentId !== context.documentId) return;
    if (request.kind === "failure") {
      discard(event.sender.id);
      return;
    }
    if (!args.manager.enabled()) return;
    observe(event.sender);
    if (request.kind === "username")
      usernames.set(event.sender.id, {
        origin: context.origin,
        value: request.username,
        expires: Date.now() + 120_000,
      });
    if (request.kind === "capture") {
      if (drafts.size >= 32 && !drafts.has(event.sender.id)) return;
      const hint = usernames.get(event.sender.id);
      const old = drafts.get(event.sender.id),
        now = Date.now();
      if (
        !old ||
        old.password !== request.password ||
        old.username !== request.username ||
        now - old.capturedAt > 500
      ) {
        ajax.delete(event.sender.id);
        waitingSuccess.delete(event.sender.id);
        successfulAjax.delete(event.sender.id);
      }
      drafts.set(event.sender.id, {
        origin: context.origin,
        url: context.url,
        ajaxSucceeded:
          old?.documentId === context.documentId &&
          old.password === request.password &&
          now - old.capturedAt <= 500
            ? old.ajaxSucceeded
            : false,
        documentId: context.documentId,
        username:
          request.username ||
          (hint?.origin === context.origin && hint.expires > Date.now()
            ? hint.value
            : ""),
        password: request.password,
        expires: Date.now() + 120_000,
        capturedAt: now,
      });
    }
  }
  ipcMain.on(PASSWORD_PAGE_SESSION, (event) => {
    const target = args.browser()?.passwordTarget(event.sender.id);
    event.returnValue =
      event.senderFrame === event.sender.mainFrame && !!target
        ? target.context.documentId
        : null;
    if (target) observe(event.sender);
  });
  ipcMain.on(PASSWORD_PAGE_CAPTURE, (event, input: unknown) => {
    // Bounded, synchronous capture completes before the form can navigate away.
    // No disk, authentication or renderer round trips occur on this path.
    capture(event, input);
    event.returnValue = null;
  });
  async function handle(
    event: IpcMainInvokeEvent,
    input: unknown,
  ): Promise<unknown> {
    const parsed = inputSchema.safeParse(input),
      target = args.browser()?.passwordTarget(event.sender.id);
    if (
      !parsed.success ||
      !target ||
      event.senderFrame !== event.sender.mainFrame
    )
      return null;
    observe(event.sender);
    const request = parsed.data,
      context = target.context;
    const current = () =>
      !event.sender.isDestroyed() &&
      event.senderFrame === event.sender.mainFrame &&
      target.current()?.documentId === context.documentId &&
      target.current()?.origin === context.origin;
    if (
      request.kind !== "accounts" &&
      request.documentId !== context.documentId
    )
      return null;
    if (request.kind === "failure") {
      discard(event.sender.id);
      return null;
    }
    if (request.kind === "accounts" && target.visible())
      await args.manager.prepareSite(
        context.origin,
        target.hostWebContentsId,
        current,
      );
    const accounts = await args.manager.forSite(context.origin);
    if (!current()) return null;
    const hint = usernames.get(event.sender.id);
    const preferred =
      hint?.origin === context.origin && hint.expires > Date.now()
        ? hint.value
        : undefined;
    const metadata = accounts.map(({ id, version, username }) => ({
      id,
      version,
      username,
      ...(username === preferred ? { preferred: true } : {}),
    }));
    if (request.kind === "accounts") {
      const frame = (await target.credentials?.send(
        "Page.getFrameTree",
        {},
      )) as { frameTree?: { frame: { id: string } } } | undefined;
      if (!frame?.frameTree || !current()) return null;
      mainFrames.set(event.sender.id, frame.frameTree.frame.id);
      await target.credentials?.send("Page.enable", {});
      await target.credentials?.send("Network.enable", {});
      if (!current()) return null;
      const draft = drafts.get(event.sender.id);
      if (draft && draft.documentId !== context.documentId) {
        if (
          request.hasPasswordForm &&
          draft.origin === context.origin &&
          !draft.sameDocumentNavigation
        ) {
          drafts.delete(event.sender.id);
          waitingSuccess.delete(event.sender.id);
        } else void propose(event.sender.id);
      } else if (draft && !request.hasPasswordForm)
        void propose(event.sender.id);
      return { documentId: context.documentId, accounts: metadata };
    }
    if (request.kind === "fill") {
      const account = accounts.find(
        (entry) => entry.id === request.id && entry.version === request.version,
      );
      if (!account) return null;
      const page = target.credentials;
      if (!page) return null;
      const root = (await page.send("DOM.getDocument", { depth: 0 })) as {
        root?: { nodeId: number };
      };
      if (!root.root || !current()) return null;
      const nodes = (await page.send("DOM.querySelectorAll", {
        nodeId: root.root.nodeId,
        selector: `[data-patcher-password-field="${request.fieldToken}"]`,
      })) as { nodeIds?: number[] };
      if (nodes.nodeIds?.length !== 1) return null;
      for (const nodeId of nodes.nodeIds) {
        const node = (await page.send("DOM.describeNode", { nodeId })) as {
          node?: { backendNodeId: number };
        };
        if (!node.node || !current()) return null;
        page.rememberPassword(node.node.backendNodeId);
      }
      const password = await args.manager.password(account, current);
      return current() ? { username: account.username, password } : null;
    }
    if (request.kind === "success") void propose(event.sender.id);
    return null;
  }
  ipcMain.handle(PASSWORD_PAGE_CHANNEL, (event, input: unknown) =>
    handle(event, input).catch(() => null),
  );
  const expiry = setInterval(() => {
    for (const [id, draft] of drafts)
      if (draft.expires < Date.now()) {
        discard(id);
      }
    for (const [id, hint] of usernames)
      if (hint.expires < Date.now()) usernames.delete(id);
  }, 10_000);
  expiry.unref();
  return {
    reset,
    showPending() {
      for (const id of drafts.keys()) void propose(id);
    },
    cancelView(id: number) {
      discard(id);
    },
    changed() {
      for (const contents of observed)
        if (!contents.isDestroyed()) contents.send(PASSWORD_PAGE_CHANGED);
    },
  };
}
