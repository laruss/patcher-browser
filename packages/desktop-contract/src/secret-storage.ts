import { z } from "zod";

export const DESKTOP_SECRET_STORAGE_CHANNELS = {
  status: "patcher:secret-storage:status:v1",
  activate: "patcher:secret-storage:activate:v1",
  unlock: "patcher:secret-storage:unlock:v1",
} as const;
export const desktopSecretStorageStatusSchema = z
  .object({
    mode: z.enum(["plaintext", "encrypted"]),
    available: z.boolean(),
    migrationPending: z.boolean(),
    unprocessedEntries: z.number().int().nonnegative(),
    error: z
      .enum([
        "unavailable",
        "locked",
        "corrupt",
        "unsupported_version",
        "conflict",
        "invalid_request",
        "cancelled",
      ])
      .nullable(),
  })
  .strict();
export type DesktopSecretStorageStatus = z.infer<
  typeof desktopSecretStorageStatusSchema
>;
export interface DesktopSecretStorageApi {
  status(): Promise<DesktopSecretStorageStatus>;
  activate(): Promise<DesktopSecretStorageStatus>;
  unlock(): Promise<DesktopSecretStorageStatus>;
}
