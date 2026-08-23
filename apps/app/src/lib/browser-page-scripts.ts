import { useEffect } from "react";
import {
  PATCHER_DESKTOP_BROWSER_MAX_PAGE_SCRIPT_JSON_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_PAGE_SCRIPTS,
} from "@patcher/desktop-contract";
import { matchesBrowserUrlPattern } from "@patcher/domain/browser-url-pattern";
import { usePluginContributions } from "@/hooks/queries/plugin-contribution-queries";
import { callPluginRpc } from "@/lib/plugin-sdk-hooks";
import { getDesktopBrowserApi } from "./patcher-desktop";

/** Longest refusal the shell will carry back to a page script. */
const MAX_MESSAGE_LENGTH = 1024;

/**
 * Hands the shell the page scripts plugins declared, and answers what those
 * scripts ask of their own plugins.
 *
 * Mounted above the router beside the page styles, for the same reason: a script
 * belongs to a site, not to a route, and a plugin installed while the user is
 * reading a thread has to take effect without a visit to the browser surface.
 *
 * Why the app is in this path at all: the script runs in a browsed page, which
 * cannot be given credentials, and the shell holds none either. This window is
 * the only participant that can authenticate to the Patcher server — so it performs
 * the call, and re-checks on the way that the plugin really does claim the page
 * the shell says asked. Two checks of the same rule, in the two processes that
 * would have to be wrong together.
 */
export function useBrowserPageScripts(): void {
  const scripts = usePluginContributions().data?.browserPageScripts;

  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    // Feature-detected like `setPageStyles`: a shell without this channel runs
    // no page scripts at all, so there is nothing to tell it.
    if (browserApi?.setPageScripts === undefined) {
      return;
    }
    // Nothing to say until the list is known, like the page styles beside this:
    // an empty push while the query loads would unregister the shell's preload,
    // so a page loading in that window would run no script at all.
    if (scripts === undefined) {
      return;
    }
    browserApi.setPageScripts({
      // Capped to what the shell's parser will accept: over that it drops the
      // whole push and keeps the list it already had, so one plugin declaring
      // too many would leave every plugin's scripts stale.
      scripts: scripts
        .slice(0, PATCHER_DESKTOP_BROWSER_MAX_PAGE_SCRIPTS)
        .map((script) => ({
          pluginId: script.pluginId,
          scriptId: script.scriptId,
          matches: script.matches,
          code: script.code,
        })),
    });
  }, [scripts]);

  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (
      browserApi?.onPageScriptCall === undefined ||
      browserApi.respondToPageScriptCall === undefined
    ) {
      return;
    }
    const respond = browserApi.respondToPageScriptCall.bind(browserApi);
    return browserApi.onPageScriptCall((call) => {
      const claimed = (scripts ?? []).some(
        (script) =>
          script.pluginId === call.pluginId &&
          script.matches.some((pattern) =>
            matchesBrowserUrlPattern(pattern, call.url),
          ),
      );
      if (!claimed) {
        respond({
          callId: call.callId,
          ok: false,
          message: `patcher.rpc: plugin "${call.pluginId}" declares no page script for this address.`,
        });
        return;
      }
      void answer(call.method, call.pluginId, call.input)
        .then((result) => {
          respond({ callId: call.callId, ok: true, result });
        })
        .catch((error: unknown) => {
          respond({
            callId: call.callId,
            ok: false,
            message: truncate(
              error instanceof Error ? error.message : "the call failed",
            ),
          });
        });
    });
  }, [scripts]);
}

/**
 * One rpc call on a page script's behalf, in and out as JSON text.
 *
 * The input is re-parsed rather than forwarded as a string because the rpc client
 * is the one place that decides what a valid input is, and the page must not get a
 * second opinion. An answer too large to carry is refused here, where the message
 * can say so, rather than dropped by the shell's parser — which would leave the
 * script waiting for the timeout with nothing to read.
 */
async function answer(
  method: string,
  pluginId: string,
  input: string,
): Promise<string> {
  const parsed: unknown = input.length === 0 ? null : JSON.parse(input);
  const result = await callPluginRpc(fetch, pluginId, method, parsed);
  const serialized = result === undefined ? "" : JSON.stringify(result);
  if (serialized.length > PATCHER_DESKTOP_BROWSER_MAX_PAGE_SCRIPT_JSON_LENGTH) {
    throw new Error(
      `patcher.rpc("${method}"): the answer is too large to hand to a page.`,
    );
  }
  return serialized;
}

function truncate(message: string): string {
  return message.length > MAX_MESSAGE_LENGTH
    ? message.slice(0, MAX_MESSAGE_LENGTH)
    : message;
}
