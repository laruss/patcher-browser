import { spawn } from "node:child_process";

/** The fixed helper path comes from the signed application resources, never IPC. */
export function authenticatePasswordManager(
  helperPath: string,
  reason: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (process.platform !== "darwin" || signal.aborted)
    return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawn(helperPath, [reason], { stdio: "ignore" });
    let settled = false,
      cancelled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
      resolve(success && !cancelled && !signal.aborted);
    };
    const cancel = () => {
      cancelled = true;
      child.kill();
    };
    const timeout = setTimeout(cancel, 120_000);
    signal.addEventListener("abort", cancel, { once: true });
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
    if (signal.aborted) cancel();
  });
}
