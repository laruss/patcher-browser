import { PatcherHttpError } from "@patcher/sdk";
import { describeRefusedCredential } from "./app-credential-hint.js";
import { getErrorMessage } from "./commands/helpers.js";

export class CliExitError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "CliExitError";
    this.exitCode = exitCode;
  }
}

type CommandActionArgs = readonly unknown[];
type CommandAction<TArgs extends CommandActionArgs> = (
  ...args: TArgs
) => Promise<void>;

export function action<TArgs extends CommandActionArgs>(
  fn: CommandAction<TArgs>,
): CommandAction<TArgs> {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err: unknown) {
      if (isProcessExitError(err)) {
        throw err;
      }
      if (err instanceof CliExitError) {
        console.error(`Error: ${err.message}`);
        process.exit(err.exitCode);
        return;
      }
      // A 401 reaches here as "HTTP 401: Unauthorized", which names neither
      // the credential nor where this process looked for it. Every command goes
      // through this wrapper, so this is the one place that has to say it.
      const credential =
        err instanceof PatcherHttpError && err.status === 401
          ? describeRefusedCredential()
          : null;
      console.error(
        `Error: ${getErrorMessage(err)}${credential === null ? "" : `\n${credential}`}`,
      );
      process.exit(1);
    }
  };
}

function isProcessExitError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("process.exit:");
}
