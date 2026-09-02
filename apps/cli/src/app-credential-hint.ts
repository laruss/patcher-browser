import { homedir } from "node:os";
import { join } from "node:path";
import { PATCHER_APP_KEY_FILE_NAME } from "@patcher/config/app-key";
import {
  resolveRuntimeDataDir,
  resolveRuntimeMode,
} from "@patcher/config/runtime";
import { toOptionalString } from "@patcher/config/strings";
import {
  parseThreadCredential,
  PATCHER_THREAD_KEY_ENV,
} from "@patcher/config/thread-api-key";

/**
 * What to say when the server refuses this CLI with a 401.
 *
 * `client.ts` has always claimed that a missing key is fine because "the request
 * then gets a 401 that says so, which is a better failure than one thrown from
 * inside a `fetch` wrapper". The 401 did not say so. It said
 * `HTTP 401: Unauthorized`, and the two things a caller needs — the environment
 * variable, and *which* data dir this process looked in — were discoverable only
 * by reading `app-key-file.ts`. That is fatal for an agent with no source to
 * read, and the data dir is exactly the part that cannot be guessed: a dev
 * checkout resolves a different one from an installed Patcher, which is the
 * whole reason the same command works in one shell and not the next.
 *
 * So this reports what was actually looked at, with the path filled in.
 */

export interface AppCredentialHintArgs {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

/**
 * Where the app key would be read from, or why this process cannot name it.
 *
 * Mirrors `resolveAppApiKey`'s own resolution rather than describing it: the
 * point of the message is to be true about this process, and a second
 * description of the same rule is a second thing to get wrong. In a dev checkout
 * with no repo root there is genuinely no data dir to name — `resolveRuntimeDataDir`
 * throws — and saying that is more useful than printing a path that is not the
 * one being used.
 */
function describeKeyFile(args: AppCredentialHintArgs): string {
  const env = args.env ?? process.env;
  try {
    const dataDir = resolveRuntimeDataDir({
      env,
      homeDir: args.homeDir ?? homedir(),
      mode: resolveRuntimeMode(env.NODE_ENV),
    });
    return join(dataDir, PATCHER_APP_KEY_FILE_NAME);
  } catch {
    return `<data dir>/${PATCHER_APP_KEY_FILE_NAME} — and this shell cannot name the data dir: it is not a production install and PATCHER_DATA_DIR is unset, so set PATCHER_DATA_DIR or PATCHER_APP_KEY`;
  }
}

/**
 * The line to add to a 401, or null when there is nothing useful to add.
 *
 * Null rather than a guess for the case where a key *was* presented: the request
 * carried a credential and it was refused, and telling the caller to go find a
 * credential it already has would send it after the wrong problem.
 */
export function describeRefusedCredential(
  args: AppCredentialHintArgs = {},
): string | null {
  const env = args.env ?? process.env;
  const threadKey = toOptionalString(env[PATCHER_THREAD_KEY_ENV]);
  if (threadKey !== undefined) {
    // An agent's shell. It is handed a credential scoped to its thread and
    // deliberately not the app key, so "go read the key file" is advice that
    // would undo the narrower credential if followed — see thread-api-key.ts.
    //
    // This line once claimed the credential is "refused once the turn that
    // issued it has ended" when nothing did that, and PR #45 took the claim
    // out. It is true now, and specifically: a turn credential is accepted
    // while its thread has a turn running, a terminal's while that terminal is
    // open. So the likeliest reason for the 401 that brought you here is that
    // the lifetime is over — which is worth saying, because it is the one
    // thing a caller inside the shell cannot see. Which of the two it holds is
    // read off the credential rather than guessed.
    const claim = parseThreadCredential(threadKey);
    const lifetime =
      claim?.kind === "terminal"
        ? "It is this terminal's credential: accepted while the terminal is open, so a refusal means the terminal has closed."
        : "It is this turn's credential: accepted while the turn is running, so a refusal most likely means the turn has ended.";
    return `This shell carries a thread credential (${PATCHER_THREAD_KEY_ENV}), not the app key. It proves this thread and is charged this thread's limits, and it does not open routes that are the app's alone. ${lifetime} Nothing to fix here from inside the turn.`;
  }
  const fromEnv = toOptionalString(env.PATCHER_APP_KEY);
  if (fromEnv !== undefined) {
    return `PATCHER_APP_KEY is set in this shell and was presented; the server did not accept it. It is probably from a different install — the current one writes ${describeKeyFile(args)}.`;
  }
  return `No app key found: looked at $PATCHER_APP_KEY (unset) and ${describeKeyFile(args)}. The server writes that file at startup, so start Patcher — or export PATCHER_APP_KEY from an install that has one.`;
}
