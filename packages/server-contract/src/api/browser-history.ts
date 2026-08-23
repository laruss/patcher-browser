import { z } from "zod";
import {
  BROWSER_HISTORY_LIMIT_MAX,
  BROWSER_HISTORY_QUERY_MAX_LENGTH,
  BROWSER_HISTORY_SCOPE_ID_MAX_LENGTH,
  BROWSER_HISTORY_URL_MAX_LENGTH,
} from "@patcher/domain";

/**
 * Longer than what is stored: `recordBrowserHistoryVisit` truncates the title
 * to `BROWSER_HISTORY_TITLE_MAX_LENGTH`, so a page with an essay for a title is
 * recorded short rather than refused.
 */
const BROWSER_HISTORY_TITLE_REQUEST_MAX_LENGTH = 8_192;

const browserHistoryScopeIdSchema = z
  .string()
  .min(1)
  .max(BROWSER_HISTORY_SCOPE_ID_MAX_LENGTH);

export const browserHistoryEntrySchema = z
  .object({
    id: z.string().min(1),
    /** The surface the visit happened on — a thread id, or the browser's own. */
    scopeId: browserHistoryScopeIdSchema,
    url: z.string().min(1).max(BROWSER_HISTORY_URL_MAX_LENGTH),
    title: z.string().nullable(),
    visitCount: z.number().int().positive(),
    lastVisitedAt: z.number().int().nonnegative(),
  })
  .strict();
export type BrowserHistoryEntry = z.infer<typeof browserHistoryEntrySchema>;

export const browserHistoryQuerySchema = z
  .object({
    limit: z.string().regex(/^\d+$/),
    /** Substring of the URL or title, matched case-insensitively. */
    query: z.string().max(BROWSER_HISTORY_QUERY_MAX_LENGTH),
    scopeId: browserHistoryScopeIdSchema,
  })
  .partial();
export type BrowserHistoryQuery = z.infer<typeof browserHistoryQuerySchema>;

export const browserHistoryResponseSchema = z
  .object({
    entries: z.array(browserHistoryEntrySchema).max(BROWSER_HISTORY_LIMIT_MAX),
  })
  .strict();
export type BrowserHistoryResponse = z.infer<
  typeof browserHistoryResponseSchema
>;

export const recordBrowserHistoryVisitRequestSchema = z
  .object({
    scopeId: browserHistoryScopeIdSchema,
    url: z.string().min(1).max(BROWSER_HISTORY_URL_MAX_LENGTH),
    title: z.string().max(BROWSER_HISTORY_TITLE_REQUEST_MAX_LENGTH).nullable(),
    /**
     * When the visit happened. Omit for now, which is what a browsing tab
     * sends; set it to import visits that happened somewhere else.
     */
    visitedAt: z.number().int().nonnegative().optional(),
  })
  .strict();
export type RecordBrowserHistoryVisitRequest = z.infer<
  typeof recordBrowserHistoryVisitRequestSchema
>;

export const recordBrowserHistoryVisitResponseSchema = z
  .object({
    /** Null when a plugin's history filter dropped the visit. */
    entry: browserHistoryEntrySchema.nullable(),
  })
  .strict();
export type RecordBrowserHistoryVisitResponse = z.infer<
  typeof recordBrowserHistoryVisitResponseSchema
>;

export const clearBrowserHistoryRequestSchema = z
  .object({
    /** One surface's history; null clears all of it. */
    scopeId: browserHistoryScopeIdSchema.nullable(),
  })
  .strict();
export type ClearBrowserHistoryRequest = z.infer<
  typeof clearBrowserHistoryRequestSchema
>;

export const clearBrowserHistoryResponseSchema = z
  .object({
    removed: z.number().int().nonnegative(),
  })
  .strict();
export type ClearBrowserHistoryResponse = z.infer<
  typeof clearBrowserHistoryResponseSchema
>;
