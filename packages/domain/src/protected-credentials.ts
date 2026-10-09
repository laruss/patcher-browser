import { z } from "zod";
import { siteOriginSchema } from "./plugin-site-access.js";

export const CREDENTIAL_REQUEST_TIMEOUT_MS = 120_000;
export const credentialReferenceSchema = z
  .object({ id: z.uuid(), version: z.number().int().positive() })
  .strict();
export const credentialProtectionSchema = z.enum([
  "require-touch-id",
  "confirm-each-time",
]);
export const credentialMetadataSchema = credentialReferenceSchema
  .extend({
    origin: siteOriginSchema,
    accountId: z.string().min(1).max(128),
    username: z.string().max(1024),
    protection: credentialProtectionSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export const credentialListArgsSchema = z
  .object({ tabId: z.string().min(1).max(128) })
  .strict();
export const credentialRequestArgsSchema = z.discriminatedUnion("operation", [
  credentialListArgsSchema
    .extend({
      operation: z.literal("save"),
      accountId: z.string().min(1).max(128),
    })
    .strict(),
  credentialListArgsSchema
    .extend({
      operation: z.enum(["update", "fill", "delete"]),
      reference: credentialReferenceSchema,
    })
    .strict(),
]);
export const credentialResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.enum(["saved", "updated"]),
      credential: credentialMetadataSchema,
    })
    .strict(),
  z
    .object({
      status: z.enum([
        "filled",
        "deleted",
        "cancelled",
        "denied",
        "unavailable",
        "unsupported",
        "busy",
      ]),
    })
    .strict(),
]);
export type CredentialMetadata = z.infer<typeof credentialMetadataSchema>;
export type CredentialRequestArgs = z.infer<typeof credentialRequestArgsSchema>;
export type CredentialResult = z.infer<typeof credentialResultSchema>;
export type CredentialProtection = z.infer<typeof credentialProtectionSchema>;
export interface PluginBrowserCredentials {
  /** Metadata only. Requires credentials.manage and a live runtime site grant. */
  list(
    args: z.infer<typeof credentialListArgsSchema>,
    options?: { signal?: AbortSignal },
  ): Promise<CredentialMetadata[]>;
  /** Creates an inert proposal in core browser chrome. Only a person can review it.
   * No plaintext, reveal, export, submit or automatic retry. Agent callers are refused. */
  request(
    args: CredentialRequestArgs,
    options?: { signal?: AbortSignal },
  ): Promise<CredentialResult>;
}

// Owned-server ↔ Electron main only. Never returned to SDK or app renderers.
export const sealedCredentialSchema = credentialMetadataSchema
  .extend({
    owner: z.string().min(1).max(128),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    vaultId: z.uuid(),
    format: z.literal(1),
    seal: z.string().min(1).max(16000),
    nonce: z.string().max(32),
    ciphertext: z.string().max(65536),
    tag: z.string().max(32),
  })
  .strict();
export type SealedCredential = z.infer<typeof sealedCredentialSchema>;
export const credentialPrivateRequestSchema = z
  .object({
    token: z.uuid(),
    expectedVaultId: z.uuid().optional(),
    owner: z.string().min(1).max(128),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    request: credentialRequestArgsSchema,
    record: sealedCredentialSchema.optional(),
    draft: z
      .object({ id: z.uuid(), createdAt: z.number().int().nonnegative() })
      .strict()
      .optional(),
  })
  .strict();
export const credentialPrivateResultSchema = z
  .object({
    result: credentialResultSchema,
    record: sealedCredentialSchema.optional(),
  })
  .strict();
export const credentialPendingSchema = z
  .object({
    id: z.uuid(),
    tabId: z.string().min(1).max(128),
    pluginId: z.string().min(1).max(128),
    pluginName: z.string().max(256),
    origin: siteOriginSchema,
    accountId: z.string().max(128),
    operation: z.enum(["save", "update", "fill", "delete"]),
    protection: credentialProtectionSchema.optional(),
    reviewing: z.boolean(),
  })
  .strict();
export type CredentialPending = z.infer<typeof credentialPendingSchema>;
