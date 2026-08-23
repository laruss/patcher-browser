import { utilityProcess } from "electron";
import {
  parseBrowserPdfTextMessage,
  type DesktopBrowserPdfTextOutcome,
} from "./desktop-browser-pdf-text.js";

/**
 * Fork the PDF parser, ask it one question, and take the answer away from it.
 *
 * The lifecycle is the point, so it is all in one place: a process is forked
 * per document, killed the moment it answers, and killed the same way when it
 * does not. Nothing is reused between reads — see pdf-text-process.ts for why
 * a pool would be the wrong trade — so there is no state here to get wrong
 * beyond making sure the child never outlives its answer.
 *
 * Every failure lands on the same two words. A child that crashes, exits
 * without answering, sends nonsense, or has to be killed for taking too long
 * are all "the document could not be read", and inventing separate reasons for
 * them would offer a caller a distinction it cannot act on.
 */
export function createBrowserPdfTextExtractor(args: {
  /** `dist/pdf-text-process.js`, resolved by the caller that knows the paths. */
  modulePath: string;
}): (request: {
  bytes: Uint8Array;
  timeoutMs: number;
}) => Promise<DesktopBrowserPdfTextOutcome> {
  return async ({ bytes, timeoutMs }) =>
    await new Promise<DesktopBrowserPdfTextOutcome>((resolve) => {
      const child = utilityProcess.fork(args.modulePath, [], {
        // Named for the Activity Monitor row it becomes, and silenced because
        // a parser's chatter about a malformed document is the page's content
        // talking, not ours.
        serviceName: "patcher-pdf-text",
        stdio: "ignore",
      });

      let settled = false;
      const finish = (outcome: DesktopBrowserPdfTextOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        // Unconditional: a child that answered has nothing left to do, and a
        // child that timed out is the reason this runs out of process at all.
        child.kill();
        resolve(outcome);
      };

      const timer = setTimeout(() => {
        finish({ ok: false, reason: "timeout" });
      }, timeoutMs);

      child.on("spawn", () => {
        child.postMessage({ bytes });
      });
      child.on("message", (message: unknown) => {
        finish(parseBrowserPdfTextMessage(message));
      });
      child.on("exit", () => {
        finish({ ok: false, reason: "unreadable" });
      });
    });
}
