import {
  BROWSER_COMMAND_MAX_PAGE_TEXT_LENGTH,
  type BrowserCommand,
  type BrowserCommandOutcome,
  type BrowserCommandValue,
} from "@patcher/domain";
import { runtimeSiteCommandSupported } from "@patcher/domain/plugin-site-access";
import {
  annotateSnapshotRefs,
  browserInteractionRefs,
  browserRefGeneration,
  splitBrowserRef,
  withBareBrowserRefs,
} from "@patcher/domain/browser-command-refs";
import { browserScrollExpression } from "@patcher/domain/browser-command-scroll";
import type {
  DesktopBrowserHostWindow,
  DesktopBrowserViewManager,
} from "./desktop-browser-view.js";
import type { DesktopSiteAuthority } from "./desktop-site-authority.js";
import { runBrowserSiteOperation } from "./browser-site-operation.js";

const refused = (): BrowserCommandOutcome => ({
  ok: false,
  code: "external_access_denied",
  message: "Runtime site access refused this command",
});
const failed = (): BrowserCommandOutcome => ({
  ok: false,
  code: "page_read_failed",
  message: "The page could not complete this command",
});
const success = (value: BrowserCommandValue): BrowserCommandOutcome => ({
  ok: true,
  value,
});

/** Runtime plugins never execute through the renderer's legacy browser runner. */
export async function executeScopedBrowserCommand(args: {
  manager: DesktopBrowserViewManager;
  authority: DesktopSiteAuthority;
  hostWindow: DesktopBrowserHostWindow;
  token: string;
  command: BrowserCommand;
}): Promise<BrowserCommandOutcome> {
  let active = true;
  let removeAbort: (() => void) | undefined;
  let lease: ReturnType<DesktopSiteAuthority["consume"]> | undefined;
  try {
    if (
      !runtimeSiteCommandSupported(args.command) ||
      !("tabId" in args.command) ||
      !args.command.tabId
    )
      return refused();
    const tabId = args.command.tabId;
    lease = args.authority.consume(
      args.token,
      args.command,
      args.hostWindow.webContents.id,
    );
    const guard = lease;
    const assert = () => {
      if (!active) throw new Error("Expired browser operation");
      guard.assert();
    };
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new Error("Revoked browser operation"));
      guard.signal.addEventListener("abort", onAbort, { once: true });
      removeAbort = () => guard.signal.removeEventListener("abort", onAbort);
    });
    const work = runBrowserSiteOperation(
      assert,
      async () => {
        assert();
        const result = await dispatch(
          args.manager,
          args.hostWindow,
          args.command,
          tabId,
        );
        assert();
        return result;
      },
      guard.context.url,
    );
    return await Promise.race([work, aborted]);
  } catch {
    return refused();
  } finally {
    removeAbort?.();
    active = false;
    lease?.close();
  }
}

async function dispatch(
  manager: DesktopBrowserViewManager,
  hostWindow: DesktopBrowserHostWindow,
  command: BrowserCommand,
  tabId: string,
): Promise<BrowserCommandOutcome> {
  switch (command.type) {
    case "page.get_url":
    case "page.get_title":
    case "page.get_text":
    case "page.get_selection": {
      const read =
        command.type === "page.get_text" && command.selector !== null
          ? await manager.readPageIn({
              hostWindow,
              request: { tabId, selector: command.selector },
            })
          : await manager.readPage({ hostWindow, tabId, allowPdf: false });
      if (!read.ok || read.contentKind === "pdf") return failed();
      if (command.type === "page.get_url")
        return success({ type: "url", url: read.url });
      if (command.type === "page.get_title")
        return success({ type: "title", title: read.title });
      if (command.type === "page.get_selection")
        return success({
          type: "text",
          text: read.selection,
          truncated: read.selectionTruncated,
        });
      const text = read.text.slice(0, command.maxLength);
      return success({
        type: "text",
        text,
        truncated: read.textTruncated || text.length < read.text.length,
      });
    }
    case "page.snapshot": {
      const request = {
        tabId,
        ...(command.maxDepth === null ? {} : { maxDepth: command.maxDepth }),
      };
      const result =
        command.selector === null
          ? await manager.snapshot({ hostWindow, request })
          : await manager.snapshotIn({
              hostWindow,
              request: { ...request, selector: command.selector },
            });
      if (!result.ok) return failed();
      const annotated = annotateSnapshotRefs(
        result.snapshot,
        result.generation,
        BROWSER_COMMAND_MAX_PAGE_TEXT_LENGTH,
      );
      return success({
        type: "snapshot",
        tabId,
        url: result.url,
        title: result.title,
        snapshot: annotated.snapshot,
        generation: result.generation,
        refCount: result.refCount,
        truncated: result.truncated || annotated.truncated,
      });
    }
    case "page.interact": {
      const generation = browserRefGeneration({
        declared: command.generation,
        refs: browserInteractionRefs(command.interaction),
      });
      if (!generation.ok)
        return {
          ok: false,
          code: "invalid_command",
          message: generation.message,
        };
      const result = await manager.interact({
        hostWindow,
        request: {
          tabId,
          ...(generation.generation === null
            ? {}
            : { generation: generation.generation }),
          interaction: withBareBrowserRefs(command.interaction),
        },
      });
      if (!result.ok) return failed();
      return success({
        type: "interacted",
        tabId,
        url: result.url,
        title: result.title,
      });
    }
    case "page.control":
    case "page.scroll": {
      if (
        command.type === "page.control" &&
        command.operation.kind !== "evaluate"
      )
        return refused();
      const ref =
        command.type === "page.scroll"
          ? command.target.kind === "element"
            ? command.target.ref
            : null
          : command.operation.kind === "evaluate"
            ? command.operation.ref
            : null;
      const declared =
        command.type === "page.scroll"
          ? command.target.kind === "element"
            ? command.target.generation
            : null
          : command.generation;
      const generation = browserRefGeneration({ declared, refs: [ref] });
      if (!generation.ok)
        return {
          ok: false,
          code: "invalid_command",
          message: generation.message,
        };
      const expression =
        command.type === "page.scroll"
          ? browserScrollExpression(command.target)
          : command.operation.kind === "evaluate"
            ? command.operation.expression
            : "";
      const result = await manager.control({
        hostWindow,
        request: {
          tabId,
          ...(generation.generation === null
            ? {}
            : { generation: generation.generation }),
          operation: {
            kind: "evaluate",
            expression,
            ref: ref === null ? null : splitBrowserRef(ref).ref,
          },
        },
      });
      if (!result.ok || result.kind !== "evaluated") return failed();
      return success({
        type: "evaluated",
        tabId,
        url: result.url,
        title: result.title,
        value: result.value,
        truncated: result.truncated,
      });
    }
    case "page.observe": {
      if (
        command.observation.kind !== "screenshot" ||
        command.observation.fullPage
      )
        return refused();
      const result = await manager.observe({
        hostWindow,
        request: {
          tabId,
          observation: {
            kind: "screenshot",
            format: command.observation.format,
            quality: command.observation.quality,
          },
        },
      });
      if (!result.ok || result.kind !== "screenshot") return failed();
      return success({
        type: "image",
        tabId,
        url: result.url,
        title: result.title,
        mimeType: result.mimeType,
        base64: result.base64,
        width: result.width,
        height: result.height,
        fullPage: false,
        truncated: false,
      });
    }
    default:
      return refused();
  }
}
