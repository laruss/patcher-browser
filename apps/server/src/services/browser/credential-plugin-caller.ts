import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  credentialAgentCaller,
  runAsCredentialAgent,
} from "./credential-agent-scope.js";
import { currentBrowserCommandIssuer } from "./browser-command-issuer.js";
import { currentExternalBrowserCaller } from "./browser-external-access.js";
import { currentPluginSiteCallers } from "./plugin-site-caller.js";

// Separate from runtime browser callers: legacy browser behavior stays compatible,
// but an authenticated legacy deputy cannot disappear from vault authorization.
const callers = new AsyncLocalStorage<readonly string[]>();
export const currentCredentialPluginCallers = () => callers.getStore() ?? [];
export function runWithCredentialPluginCallers<T>(
  ids: readonly string[],
  work: () => T,
): T {
  return callers.run(
    [...new Set([...currentCredentialPluginCallers(), ...ids])],
    work,
  );
}
export { CREDENTIAL_CALLER_HEADER } from "./credential-http-header.js";
const http = new Map<
  string,
  {
    pluginId: string;
    agent: boolean;
    ids: readonly string[];
    timer: ReturnType<typeof setTimeout>;
  }
>();
// Both in-process SDK fetch and child host calls mint correlation in the server.
// A hard lifetime/cap bounds calls whose child or HTTP request never settles.
export function createCredentialHttpCaller(pluginId: string): string {
  if (http.size >= 1024) throw Error("Too many SDK requests");
  const token = randomUUID(),
    timer = setTimeout(() => http.delete(token), 30_000);
  timer.unref();
  http.set(token, {
    pluginId,
    timer,
    agent:
      credentialAgentCaller() ||
      !!currentBrowserCommandIssuer() ||
      !!currentExternalBrowserCaller(),
    ids: [
      ...new Set([
        ...currentCredentialPluginCallers(),
        ...currentPluginSiteCallers(),
      ]),
    ],
  });
  return token;
}
export function releaseCredentialHttpCaller(
  pluginId: string,
  token: string,
): boolean {
  const entry = http.get(token);
  if (!entry || entry.pluginId !== pluginId) return false;
  clearTimeout(entry.timer);
  http.delete(token);
  return true;
}
export function runAsCredentialHttpCaller<T>(
  pluginId: string,
  token: string | undefined,
  work: () => T,
): T {
  if (token === undefined) return work();
  const entry = http.get(token);
  if (!entry || entry.pluginId !== pluginId) return runAsCredentialAgent(work);
  releaseCredentialHttpCaller(pluginId, token);
  return runWithCredentialPluginCallers(entry.ids, () =>
    entry.agent ? runAsCredentialAgent(work) : work(),
  );
}
