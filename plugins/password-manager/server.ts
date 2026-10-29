import type { PatcherPluginApi } from "@patcher/plugin-sdk";
import {
  rpcContract,
  type ManagerView,
  type ManagerResult,
} from "./contracts.js";
import { httpsOrigin } from "./origin.js";
import { observeLoginForms } from "./page-script.js";

export default function plugin(patcher: PatcherPluginApi) {
  const requests = new Map<
    string,
    { id: string; controller: AbortController }
  >();
  const disposed = new AbortController();
  const hintTimes = new Map<string, number>();
  const current = async (tabId: string, origin: string, signal?: AbortSignal) =>
    httpsOrigin(await patcher.browser.page.getUrl({ tabId }, { signal })) ===
    origin;

  patcher.browser.registerPageScript({
    id: "login-hints",
    matches: ["https://**"],
    code: `(${observeLoginForms.toString()})(patcher);`,
  });
  patcher.browser.registerToolbarItem({
    id: "logins",
    title: "Password manager — use the side panel",
    icon: "Key",
    async state({ tabId }) {
      try {
        const accounts = await patcher.browser.credentials.list({ tabId });
        return {
          active: accounts.length > 0,
          title: `${accounts.length} saved logins — use the side panel`,
        };
      } catch {
        return null;
      }
    },
    run({ tabId, url }) {
      const origin = httpsOrigin(url);
      if (origin) patcher.realtime.publish("refresh", { tabId, origin });
    },
  });
  patcher.rpc.register(rpcContract, {
    async view({ tabId, origin }): Promise<ManagerView> {
      if (!patcher.browser.getStatus().connected)
        return { status: "unavailable", accounts: [] };
      try {
        if (!(await current(tabId, origin, disposed.signal)))
          return { status: "unsupported", accounts: [] };
        const accounts = await patcher.browser.credentials.list(
          { tabId },
          { signal: disposed.signal },
        );
        if (accounts.some((account) => account.origin !== origin))
          return { status: "denied", accounts: [] };
        return { status: "ready", accounts };
      } catch {
        return { status: "denied", accounts: [] };
      }
    },
    async request(input): Promise<ManagerResult> {
      if (requests.has(input.tabId) || requests.size >= 16)
        return { status: "busy" };
      const entry = { id: input.requestId, controller: new AbortController() };
      requests.set(input.tabId, entry);
      const signal = AbortSignal.any([
        entry.controller.signal,
        disposed.signal,
        AbortSignal.timeout(120_000),
      ]);
      try {
        if (!patcher.browser.getStatus().connected)
          return { status: "unavailable" };
        if (!(await current(input.tabId, input.origin, signal)))
          return { status: "unsupported" };
        // Await on this manual caller's stack: deferred timers/queues would lose
        // the host's page/agent/deputy attribution when the RPC call settles.
        const { origin, requestId, ...request } = input;
        const result = await patcher.browser.credentials.request(request, {
          signal,
        });
        return { status: result.status };
      } catch {
        return { status: signal.aborted ? "cancelled" : "denied" };
      } finally {
        if (requests.get(input.tabId) === entry) requests.delete(input.tabId);
      }
    },
    cancel({ requestId }) {
      const entry = [...requests.values()].find(
        (request) => request.id === requestId,
      );
      entry?.controller.abort();
      return { cancelled: entry !== undefined };
    },
    hint(input) {
      // Advisory only, including origin. This never chooses a tab/account,
      // reads credentials, persists data or creates a core proposal.
      const now = Date.now();
      if (now - (hintTimes.get(input.origin) ?? 0) >= 1000) {
        if (hintTimes.size >= 64 && !hintTimes.has(input.origin))
          hintTimes.delete(hintTimes.keys().next().value!);
        hintTimes.set(input.origin, now);
        patcher.realtime.publish("form-hint", input);
      }
      return { ok: true as const };
    },
  });
  patcher.onDispose(() => {
    disposed.abort();
    requests.clear();
    hintTimes.clear();
  });
}
