import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { SecretStorageError } from "./storage-error.js";

export const MAX_SECRET_BYTES = 1024 * 1024;
export const SECRET_NAMESPACE = "ordinary-plugin-settings";
export const SECRET_STORE_DIRECTORY = "plugin-secret-storage";
export const SECRET_STORAGE_FORMAT = 1;
export const SECRET_OWNER_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const SECRET_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;
const base64 = z
  .string()
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);

export const keyEnvelopeSchema = z
  .object({
    version: z.literal(1),
    storeId: z.uuid(),
    wrappedKey: base64.min(1).max(12_000),
  })
  .strict();
export type KeyEnvelope = z.infer<typeof keyEnvelopeSchema>;
export const storeStateSchema = z
  .object({
    version: z.literal(1),
    storeId: z.uuid(),
    phase: z.enum(["migrating", "active"]),
  })
  .strict();
export type StoreState = z.infer<typeof storeStateSchema>;

const recordSchema = z.discriminatedUnion("kind", [
  z
    .object({
      version: z.literal(1),
      kind: z.literal("deleted"),
      legacy: z
        .object({
          device: z.string(),
          inode: z.string(),
          modified: z.string(),
          changed: z.string(),
          size: z.string(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal("value"),
      nonce: base64.length(16),
      tag: base64.length(24),
      ciphertext: base64.max(Math.ceil(MAX_SECRET_BYTES / 3) * 4),
    })
    .strict(),
]);
export type EncryptedRecord = z.infer<typeof recordSchema>;

export function parseVersioned<T>(bytes: Buffer, schema: z.ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new SecretStorageError("corrupt");
  }
  if (
    value !== null &&
    typeof value === "object" &&
    "version" in value &&
    value.version !== 1
  )
    throw new SecretStorageError("unsupported_version");
  const result = schema.safeParse(value);
  if (!result.success) throw new SecretStorageError("corrupt");
  return result.data;
}

export function parseRecord(bytes: Buffer): EncryptedRecord {
  return parseVersioned(bytes, recordSchema);
}

export function validateSecretScope(owner: string, key?: string): void {
  if (
    !SECRET_OWNER_PATTERN.test(owner) ||
    (key !== undefined && !SECRET_KEY_PATTERN.test(key))
  )
    throw new SecretStorageError("invalid_request");
}

function aad(storeId: string, owner: string, key: string): Buffer {
  validateSecretScope(owner, key);
  return Buffer.from(
    JSON.stringify([
      SECRET_STORAGE_FORMAT,
      storeId,
      SECRET_NAMESPACE,
      owner,
      key,
    ]),
  );
}

export function encryptRecord(
  dataKey: Buffer,
  storeId: string,
  owner: string,
  key: string,
  value: Buffer,
): EncryptedRecord {
  if (dataKey.length !== 32 || value.length > MAX_SECRET_BYTES)
    throw new SecretStorageError("invalid_request");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey, nonce, {
    authTagLength: 16,
  });
  cipher.setAAD(aad(storeId, owner, key));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return {
    version: 1,
    kind: "value",
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptRecord(
  dataKey: Buffer,
  storeId: string,
  owner: string,
  key: string,
  record: EncryptedRecord,
): Buffer | undefined {
  if (record.kind === "deleted") return undefined;
  try {
    const nonce = Buffer.from(record.nonce, "base64");
    const tag = Buffer.from(record.tag, "base64");
    if (dataKey.length !== 32 || nonce.length !== 12 || tag.length !== 16)
      throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", dataKey, nonce, {
      authTagLength: 16,
    });
    cipher.setAAD(aad(storeId, owner, key));
    cipher.setAuthTag(tag);
    return Buffer.concat([
      cipher.update(Buffer.from(record.ciphertext, "base64")),
      cipher.final(),
    ]);
  } catch {
    throw new SecretStorageError("corrupt");
  }
}
