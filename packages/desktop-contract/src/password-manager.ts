import { z } from "zod";

// Separate channels and an optional preload API negotiate this feature with
// older server-rendered SPAs. No existing browser IPC shape changes.
export const PASSWORD_MANAGER_CHANNELS = {
  request: "patcher-desktop:password-manager:v1",
  open: "patcher-desktop:password-manager:open:v1",
  changed: "patcher-desktop:password-manager:changed:v1",
} as const;
export const passwordEntrySchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    origin: z.string(),
    username: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export type PasswordEntry = z.infer<typeof passwordEntrySchema>;
const reference = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
});
const draft = z.object({
  origin: z.string().min(1).max(2048),
  username: z.string().max(1024),
  password: z.string().min(1).max(4096),
});
export const passwordManagerRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("list") }).strict(),
  z.object({ operation: z.literal("migrate") }).strict(),
  draft.extend({ operation: z.literal("add") }).strict(),
  reference
    .extend({ operation: z.enum(["reveal", "edit", "delete"]) })
    .strict(),
  draft
    .extend({ operation: z.literal("update"), editToken: z.uuid() })
    .strict(),
  z
    .object({ operation: z.literal("cancel-edit"), editToken: z.uuid() })
    .strict(),
]);
export type PasswordManagerRequest = z.infer<
  typeof passwordManagerRequestSchema
>;
export const passwordManagerResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ready"),
      entries: z.array(passwordEntrySchema),
      migrationNeeded: z.boolean(),
    })
    .strict(),
  z.object({ status: z.literal("revealed"), password: z.string() }).strict(),
  z
    .object({
      status: z.literal("editing"),
      password: z.string(),
      editToken: z.uuid(),
    })
    .strict(),
  z
    .object({
      status: z.enum([
        "done",
        "cancelled",
        "disabled",
        "unavailable",
        "conflict",
        "duplicate",
        "invalid",
      ]),
    })
    .strict(),
]);
export type PasswordManagerResponse = z.infer<
  typeof passwordManagerResponseSchema
>;
export interface DesktopPasswordManagerApi {
  session?: import("./password-manager-session.js").DesktopPasswordManagerSessionApi;
  request(input: PasswordManagerRequest): Promise<PasswordManagerResponse>;
  onOpen(listener: () => void): () => void;
  onChange(listener: () => void): () => void;
}
