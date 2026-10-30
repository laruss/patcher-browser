import { z } from "zod";
import { sealedCredentialSchema } from "./protected-credentials.js";

// A new, authenticated policy. Legacy envelopes must be explicitly migrated;
// changing the meaning of their protection flag would bypass user consent.
export function passwordOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return !url.username &&
      !url.password &&
      url.origin.length <= 2048 &&
      (url.protocol === "http:" || url.protocol === "https:")
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
export const managerCredentialSchema = sealedCredentialSchema.extend({
  origin: z.string().refine((value) => passwordOrigin(value) === value),
  format: z.literal(2),
  protection: z.literal("system-auth"),
});
export const storedPasswordSchema = z.union([
  sealedCredentialSchema,
  managerCredentialSchema,
]);
export type ManagerCredential = z.infer<typeof managerCredentialSchema>;
export type StoredPassword = z.infer<typeof storedPasswordSchema>;
export const PASSWORD_MANAGER_PROBE = "password-manager-store-v1";
export const passwordStoreRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("status") }).strict(),
  z
    .object({
      operation: z.literal("list"),
      sourceHash: z.string(),
      after: z.string().optional(),
      origin: z.string().optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("put"),
      sourceHash: z.string(),
      record: managerCredentialSchema,
      previousVersion: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("delete"),
      sourceHash: z.string(),
      id: z.uuid(),
      version: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("migrate"),
      sourceHash: z.string(),
      records: z.array(managerCredentialSchema).min(1).max(8),
    })
    .strict(),
]);
export const passwordStoreStatusSchema = z
  .object({
    enabled: z.boolean(),
    vault: storedPasswordSchema.optional(),
    sourceHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export const passwordStorePageSchema = z
  .object({
    records: z.array(storedPasswordSchema).max(8),
    after: z.string().nullable(),
  })
  .strict();
export type PasswordStoreRequest = z.infer<typeof passwordStoreRequestSchema>;
