import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveEnvLoader, type EnvLoaderArgs } from "./env.js";
import { resolveRuntimeDataDir } from "./runtime.js";
import { toOptionalString } from "./strings.js";
import { PATCHER_APP_KEY_FILE_NAME } from "./app-key.js";

/**
 * Finding the app key on disk — the half of `app-key.ts` that needs a
 * filesystem, and the reason it is not in it.
 *
 * The names the key travels under (`app-key.ts`) are wanted by the SPA too: the
 * app sets the header on its own requests and the query parameter on the URLs a
 * browser will not let it set one on. Reading the file is a Node concern, and
 * while the two shared a module the SPA's import of a header name dragged
 * `node:fs`, `node:path` and — through `runtime.ts` — `node:crypto` into the
 * browser bundle. Vite externalizes those, so the app died on the first access
 * with a white screen and "Module node:crypto has been externalized". Splitting
 * them is what makes that unrepeatable rather than remembered:
 * `test/browser-safe-config.test.ts` walks what the SPA may import and fails on
 * a `node:` specifier anywhere under it.
 */

export interface ResolveAppApiKeyArgs extends EnvLoaderArgs {
  /** Where the key file lives, when the caller already knows the data dir. */
  dataDir?: string;
  repoRoot?: string;
}

/** Read one key file, or undefined when it is not there or is empty. */
export function readAppApiKeyFile(dataDir: string): string | undefined {
  try {
    return toOptionalString(
      readFileSync(join(dataDir, PATCHER_APP_KEY_FILE_NAME), "utf8"),
    );
  } catch {
    // No file is the normal case for a server that has never run, and the
    // caller's own error ("refused: no app key") says more than this could.
    return undefined;
  }
}

/**
 * The key for this install, or undefined when there is none to find.
 *
 * Undefined rather than a throw: a client that cannot find the key still has
 * something useful to say — it is about to be refused with a 401 that names
 * the reason — and a caller reaching a server that has never started should
 * not die inside config resolution.
 */
export function resolveAppApiKey(
  args: ResolveAppApiKeyArgs = {},
): string | undefined {
  const loader = resolveEnvLoader(args);
  const fromEnv = toOptionalString(loader.env.PATCHER_APP_KEY);
  if (fromEnv !== undefined) return fromEnv;
  if (args.dataDir !== undefined) return readAppApiKeyFile(args.dataDir);
  try {
    return readAppApiKeyFile(
      resolveRuntimeDataDir({
        env: loader.env,
        homeDir: loader.context.homeDir,
        mode: loader.mode,
        ...(args.repoRoot === undefined ? {} : { repoRoot: args.repoRoot }),
      }),
    );
  } catch {
    // A dev checkout with no repoRoot cannot name its data dir. Same answer:
    // there is no key to find from here.
    return undefined;
  }
}
