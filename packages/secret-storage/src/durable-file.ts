import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { SecretStorageError } from "./storage-error.js";

export type DurableStep =
  | "file_synced"
  | "renamed"
  | "directory_synced"
  | "legacy_deleted";

export function missingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function privateDirectory(path: string): Promise<void> {
  const created = await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new SecretStorageError("corrupt");
  await chmod(path, 0o700);
  // Persist parent entries before a ciphertext may replace its legacy source.
  let current = path;
  do {
    await syncDirectory(dirname(current));
    if (created === undefined || current === created) break;
    current = dirname(current);
  } while (current !== dirname(current));
}

export async function readPrivateFile(
  path: string,
  maxBytes: number,
): Promise<Buffer | undefined> {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > maxBytes)
        throw new SecretStorageError("corrupt");
      const bytes = await file.readFile();
      if (bytes.length > maxBytes) throw new SecretStorageError("corrupt");
      return bytes;
    } finally {
      await file.close();
    }
  } catch (error) {
    if (missingFile(error)) return undefined;
    throw error instanceof SecretStorageError
      ? error
      : new SecretStorageError("corrupt");
  }
}

export async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function durableWrite(
  path: string,
  bytes: Buffer | string,
  afterStep?: (step: DurableStep) => void,
): Promise<void> {
  await privateDirectory(dirname(path));
  const temp = join(dirname(path), `.secret-${randomUUID()}.tmp`);
  try {
    const file = await open(
      temp,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    afterStep?.("file_synced");
    await rename(temp, path);
    afterStep?.("renamed");
    await syncDirectory(dirname(path));
    afterStep?.("directory_synced");
  } finally {
    await rm(temp, { force: true });
  }
}

export async function durableDelete(
  path: string,
  afterStep?: (step: DurableStep) => void,
): Promise<void> {
  try {
    await rm(path, { force: true });
    await syncDirectory(dirname(path));
  } catch (error) {
    if (!missingFile(error)) throw error;
  }
  afterStep?.("legacy_deleted");
}
