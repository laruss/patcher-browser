import { AsyncLocalStorage } from "node:async_hooks";
const agent = new AsyncLocalStorage<boolean>();
export const credentialAgentCaller = () => agent.getStore() === true;
export const runAsCredentialAgent = <T>(fn: () => T): T => agent.run(true, fn);
