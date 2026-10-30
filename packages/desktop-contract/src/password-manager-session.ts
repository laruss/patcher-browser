import { z } from "zod";
import {
  passwordManagerRequestSchema,
  type PasswordManagerResponse,
} from "./password-manager.js";

// Optional API on a new channel: older SPAs and shells keep the v1 policy.
export const PASSWORD_MANAGER_SESSION_CHANNELS = {
  request: "patcher-desktop:password-manager:manager-session:v1",
  locked: "patcher-desktop:password-manager:locked:v1",
} as const;
export const passwordManagerSessionRequestSchema = z.discriminatedUnion(
  "operation",
  [
    ...passwordManagerRequestSchema.options,
    z
      .object({
        operation: z.literal("open"),
        origin: z.string().min(1).max(2048),
      })
      .strict(),
    z
      .object({
        operation: z.literal("copy"),
        id: z.uuid(),
        version: z.number().int().positive(),
        field: z.enum(["username", "password"]),
      })
      .strict(),
  ],
);
export type PasswordManagerSessionRequest = z.infer<
  typeof passwordManagerSessionRequestSchema
>;
export interface DesktopPasswordManagerSessionApi {
  request(
    input: PasswordManagerSessionRequest,
  ): Promise<PasswordManagerResponse>;
  onLock(listener: () => void): () => void;
}
