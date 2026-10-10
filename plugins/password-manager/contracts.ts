import { defineRpcContract } from "@patcher/plugin-sdk";
import { z } from "zod";
import { httpsOrigin } from "./origin.js";
const origin = z
  .string()
  .max(2048)
  .refine((value) => httpsOrigin(value) === value);
const target = z.object({ tabId: z.string().min(1).max(128), origin }).strict();
const reference = z
  .object({ id: z.uuid(), version: z.number().int().positive() })
  .strict();
const metadata = reference
  .extend({
    origin,
    accountId: z.string().min(1).max(128),
    username: z.string().max(1024),
    protection: z.enum(["require-touch-id", "confirm-each-time"]),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
const base = target.extend({ requestId: z.uuid() });
export const operationSchema = z.discriminatedUnion("operation", [
  base
    .extend({
      operation: z.literal("save"),
      accountId: z.string().trim().min(1).max(128),
    })
    .strict(),
  base
    .extend({ operation: z.enum(["update", "fill", "delete"]), reference })
    .strict(),
]);
export const hintSchema = z
  .object({
    origin,
    kind: z.enum(["form", "submit"]),
    present: z.boolean(),
  })
  .strict();
export const rpcContract = defineRpcContract({
  view: {
    input: target,
    output: z
      .object({
        status: z.enum(["ready", "denied", "unavailable", "unsupported"]),
        accounts: z.array(metadata),
      })
      .strict(),
  },
  request: {
    input: operationSchema,
    output: z
      .object({
        status: z.enum([
          "saved",
          "updated",
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
  },
  cancel: {
    input: z.object({ requestId: z.uuid() }).strict(),
    output: z.object({ cancelled: z.boolean() }).strict(),
  },
  hint: {
    input: hintSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
  },
});
export type ManagerView = z.infer<typeof rpcContract.view.output>;
export type ManagerResult = z.infer<typeof rpcContract.request.output>;
export type ManagerOperation = z.infer<typeof operationSchema>;
export type FormHint = z.infer<typeof hintSchema>;
