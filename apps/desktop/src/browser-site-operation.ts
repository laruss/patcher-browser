import { AsyncLocalStorage } from "node:async_hooks";

const operation = new AsyncLocalStorage<{ assert: () => void; url?: string }>();
export function assertBrowserSiteOperation() {
  operation.getStore()?.assert();
}
export function browserSiteOperationUrl() {
  return operation.getStore()?.url;
}
export function runBrowserSiteOperation<T>(
  assert: () => void,
  work: () => T,
  url?: string,
): T {
  return operation.run({ assert, url }, work);
}
