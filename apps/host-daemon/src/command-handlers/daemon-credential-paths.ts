import path from "node:path";
import { PATCHER_APP_KEY_FILE_NAME } from "@patcher/config/app-key";
import {
  PATCHER_AUTH_SECRET_FILE_NAME,
  resolveDataDirDatabasePath,
} from "@patcher/config/runtime";
import { HOST_AUTH_FILE_NAME } from "@patcher/host-daemon-contract";
import { CommandDispatchError } from "../command-dispatch-support.js";

/**
 * The files this daemon will not read, write, move or delete on anyone's behalf.
 *
 * The workspace sandbox denies a turn's own Bash these paths, but the host file
 * RPC is a second way to the same bytes and it is not in the sandbox: the daemon
 * reads them, `rootPath` is optional, and `POST /api/v1/files/read` is
 * deliberately reachable by an agent mid-turn. Without this, one `files/read` of
 * `<dataDir>/app-api-key` hands a turn the app key — and with it the app's
 * identity, which the route policy does not restrict at all.
 *
 * So the refusal lives where every caller of the RPC passes, rather than in the
 * route policy: nothing legitimate reads Patcher's own credentials back through
 * Patcher's own file API, and a caller that needs them already has the data dir.
 *
 * Mirrors `RuntimeManager.runtimeProtectedCredentialPaths`, which is the
 * sandbox's side of the same list.
 */
function daemonCredentialPaths(dataDir: string): string[] {
  const databasePath = resolveDataDirDatabasePath({ dataDir });
  return [
    path.join(dataDir, PATCHER_APP_KEY_FILE_NAME),
    path.join(dataDir, PATCHER_AUTH_SECRET_FILE_NAME),
    path.join(dataDir, HOST_AUTH_FILE_NAME),
    databasePath,
    // SQLite keeps recent writes beside the database until they are
    // checkpointed, so refusing only the main file leaks the newest rows.
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ];
}

export interface AssertNotDaemonCredentialPathArgs {
  dataDir: string;
  /**
   * Paths the command reads or writes directly. Compared for equality after
   * `path.resolve`, so `..` and a trailing slash cannot dress one up as
   * something else.
   */
  targets: readonly (string | undefined)[];
  /**
   * Paths the command destroys or moves *recursively*. Also refused when they
   * merely contain a credential file, so deleting the data directory does not
   * take the credentials with it.
   *
   * A `rootPath` is deliberately not one of these: confining a read beneath `/`
   * or `/tmp` is ordinary, and the target inside it is checked on its own.
   */
  containers?: readonly (string | undefined)[];
}

function resolvedAbsolute(value: string | undefined): string | undefined {
  // A relative path cannot name one of these, and the handler's own
  // `assertAbsoluteHostDiskPathCommand` gives a better message for it — so this
  // stays out of the way rather than pre-empting that error.
  if (value === undefined || value.length === 0) return undefined;
  return path.isAbsolute(value) ? path.resolve(value) : undefined;
}

function refuse(deniedPath: string): never {
  throw new CommandDispatchError(
    "invalid_path",
    `${deniedPath} is one of Patcher's own credential files and is not served over the file API.`,
  );
}

export function assertNotDaemonCredentialPath(
  args: AssertNotDaemonCredentialPathArgs,
): void {
  if (args.dataDir.length === 0) return;
  const denied = daemonCredentialPaths(args.dataDir);

  for (const target of args.targets) {
    const resolved = resolvedAbsolute(target);
    if (resolved === undefined) continue;
    const hit = denied.find((deniedPath) => deniedPath === resolved);
    if (hit !== undefined) refuse(hit);
  }

  for (const container of args.containers ?? []) {
    const resolved = resolvedAbsolute(container);
    if (resolved === undefined) continue;
    const hit = denied.find((deniedPath) =>
      deniedPath.startsWith(`${resolved}${path.sep}`),
    );
    if (hit !== undefined) refuse(hit);
  }
}
