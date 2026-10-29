import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  closeSync,
  constants,
  fstatSync,
  existsSync,
  fsyncSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import {
  sealedCredentialSchema,
  type SealedCredential,
} from "@patcher/domain/protected-credentials";
import type { DesktopKeyBackend } from "./desktop-secret-broker.js";

const keySchema = z
  .object({
    format: z.literal(1),
    purpose: z.literal("protected-credentials"),
    vaultId: z.uuid(),
    key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  })
  .strict();
function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function persistPrivate(path: string, bytes: Buffer | string) {
  const parent = dirname(path),
    created = mkdirSync(parent, { recursive: true, mode: 0o700 });
  let current = parent;
  do {
    syncDirectory(dirname(current));
    if (created === undefined || current === created) break;
    current = dirname(current);
  } while (current !== dirname(current));
  writeFileSync(path, bytes, { flag: "wx", mode: 0o600, flush: true });
  syncDirectory(parent);
}
export function credentialAAD(record: SealedCredential) {
  const {
    format,
    vaultId,
    owner,
    sourceHash,
    origin,
    id,
    accountId,
    username,
    version,
    protection,
    createdAt,
    updatedAt,
  } = record;
  return JSON.stringify({
    purpose: "protected-credentials",
    format,
    vaultId,
    owner,
    sourceHash,
    origin,
    id,
    accountId,
    username,
    version,
    protection,
    createdAt,
    updatedAt,
  });
}
export function createCredentialKeyStore(
  path: string,
  backend: DesktopKeyBackend,
) {
  const marker = `${path}.initialized`;
  function readKey(create: boolean) {
    if (!backend.available()) throw new Error("Unavailable");
    let wrapped: Buffer;
    try {
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 16000 || (stat.mode & 0o077) !== 0)
          throw new Error("Invalid vault key");
        wrapped = readFileSync(fd);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      if (
        !create ||
        existsSync(marker) ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      )
        throw new Error("Vault key unavailable");
      const key = randomBytes(32);
      try {
        wrapped = backend.encrypt(
          JSON.stringify({
            format: 1,
            purpose: "protected-credentials",
            vaultId: randomUUID(),
            key: key.toString("base64"),
          }),
        );
        persistPrivate(path, wrapped);
      } finally {
        key.fill(0);
      }
    }
    const parsed = keySchema.safeParse(JSON.parse(backend.decrypt(wrapped)));
    if (!parsed.success) throw new Error("Invalid vault key");
    if (existsSync(marker)) {
      const fd = openSync(marker, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = fstatSync(fd);
        if (
          !stat.isFile() ||
          stat.size > 128 ||
          (stat.mode & 0o077) !== 0 ||
          readFileSync(fd, "utf8") !== parsed.data.vaultId
        )
          throw new Error("Vault identity changed");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    } else persistPrivate(marker, parsed.data.vaultId);
    // Also finish durability after an earlier interrupted/failed initialization.
    syncDirectory(dirname(path));
    syncDirectory(dirname(dirname(path)));
    return {
      vaultId: parsed.data.vaultId,
      key: Buffer.from(parsed.data.key, "base64"),
    };
  }
  function withKey<T>(
    create: boolean,
    run: (value: { vaultId: string; key: Buffer }) => T,
  ): T {
    const value = readKey(create);
    try {
      return run(value);
    } finally {
      value.key.fill(0);
    }
  }
  return {
    // This authenticates the protection policy before prompting. It contains no key or password.
    verify(record: SealedCredential) {
      if (
        !backend.available() ||
        backend.decrypt(Buffer.from(record.seal, "base64")) !==
          credentialAAD(record)
      )
        throw new Error("Invalid credential seal");
    },
    seal(
      metadata: Omit<
        SealedCredential,
        "vaultId" | "format" | "seal" | "nonce" | "ciphertext" | "tag"
      >,
      password: string,
      expectedVaultId?: string,
    ): SealedCredential {
      if (!password || password.length > 4096)
        throw new Error("Unsupported password");
      return withKey(expectedVaultId === undefined, ({ vaultId, key }) => {
        if (expectedVaultId !== undefined && vaultId !== expectedVaultId)
          throw new Error("Wrong vault");
        const record: SealedCredential = {
          ...metadata,
          format: 1,
          vaultId,
          seal: "",
          nonce: "",
          ciphertext: "",
          tag: "",
        };
        const nonce = randomBytes(12),
          cipher = createCipheriv("aes-256-gcm", key, nonce);
        const aad = credentialAAD(record);
        cipher.setAAD(Buffer.from(aad));
        const plain = Buffer.from(password, "utf8");
        try {
          record.ciphertext = Buffer.concat([
            cipher.update(plain),
            cipher.final(),
          ]).toString("base64");
          record.nonce = nonce.toString("base64");
          record.tag = cipher.getAuthTag().toString("base64");
          record.seal = backend.encrypt(aad).toString("base64");
          return sealedCredentialSchema.parse(record);
        } finally {
          plain.fill(0);
        }
      });
    },
    open<T>(record: SealedCredential, run: (password: string) => T): T {
      this.verify(record);
      return withKey(false, ({ vaultId, key }) => {
        if (vaultId !== record.vaultId) throw new Error("Wrong vault");
        const nonce = Buffer.from(record.nonce, "base64"),
          tag = Buffer.from(record.tag, "base64");
        if (nonce.length !== 12 || tag.length !== 16)
          throw new Error("Invalid credential");
        const decipher = createDecipheriv("aes-256-gcm", key, nonce);
        decipher.setAAD(Buffer.from(credentialAAD(record)));
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([
          decipher.update(Buffer.from(record.ciphertext, "base64")),
          decipher.final(),
        ]);
        try {
          return run(plain.toString("utf8"));
        } finally {
          plain.fill(0);
        }
      });
    },
  };
}
export type CredentialKeyStore = ReturnType<typeof createCredentialKeyStore>;
