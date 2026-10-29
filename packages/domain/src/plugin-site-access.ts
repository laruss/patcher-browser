import { z } from "zod";
import { matchesBrowserUrlPattern } from "./browser-url-pattern.js";
import type { BrowserCommand } from "./browser-control.js";

export const RUNTIME_SITE_ACCESS_SDK_VERSION = "1.1.0";
export const PLUGIN_SITE_GRANT_MAX_COUNT = 64;
export function runtimeSiteCommandSupported(command: BrowserCommand): boolean {
  if (!("tabId" in command) || !command.tabId) return false;
  switch (command.type) {
    case "page.get_url":
    case "page.get_title":
    case "page.get_text":
    case "page.get_selection":
    case "page.snapshot":
    case "page.interact":
    case "page.scroll":
      return true;
    case "page.control":
      return command.operation.kind === "evaluate";
    case "page.observe":
      return (
        command.observation.kind === "screenshot" &&
        !command.observation.fullPage
      );
    default:
      return false;
  }
}

/** A website origin, never an opaque origin or a remote plaintext connection. */
export function pluginSiteOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.origin.length > 2048) return null;
    if (url.protocol === "https:") return url.origin;
    const host = url.hostname;
    if (
      url.protocol === "http:" &&
      (host === "localhost" ||
        host.endsWith(".localhost") ||
        host === "[::1]" ||
        /^127\.\d+\.\d+\.\d+$/u.test(host))
    )
      return url.origin;
    return null;
  } catch {
    return null;
  }
}

export function pluginSiteCeilingAllows(
  sites: readonly string[],
  value: string,
): boolean {
  if (pluginSiteOrigin(value) === null) return false;
  const url = new URL(value).href;
  return sites.some((pattern) => matchesBrowserUrlPattern(pattern, url));
}

export function pluginSiteAccessAllows(
  sites: readonly string[],
  origins: readonly string[],
  value: string,
): boolean {
  const origin = pluginSiteOrigin(value);
  return (
    origin !== null &&
    origins.includes(origin) &&
    pluginSiteCeilingAllows(sites, value)
  );
}

export const siteOriginSchema = z
  .string()
  .max(2048)
  .refine((value) => pluginSiteOrigin(value) === value);
export const sitePolicySchema = z
  .object({
    pluginId: z.string().min(1).max(128),
    name: z.string().min(1).max(256),
    revision: z.uuid(),
    enabled: z.boolean(),
    sites: z.array(z.string().max(2048)).max(32),
    permissions: z.array(z.string().max(128)).max(100),
    origins: z.array(siteOriginSchema).max(64),
    scripts: z.array(z.string().regex(/^[a-f0-9]{64}$/u)).max(200),
    styles: z.array(z.string().regex(/^[a-f0-9]{64}$/u)).max(200),
  })
  .strict();
export type DesktopSitePolicy = z.infer<typeof sitePolicySchema>;
export const siteContextSchema = z
  .object({
    tabId: z.string().min(1).max(128),
    url: z.string().max(4096),
    origin: siteOriginSchema,
    documentId: z.uuid(),
  })
  .strict();
export type DesktopSiteContext = z.infer<typeof siteContextSchema>;

export interface PluginSitePageContributions {
  scripts: Array<{
    pluginId: string;
    scriptId: string;
    matches: string[];
    code: string;
  }>;
  styles: Array<{
    pluginId: string;
    styleId: string;
    matches: string[];
    css: string;
  }>;
}

// New optional auth delivery contract; old prompt response schemas stay frozen.
export const scopedAuthAnswerSchema = z
  .object({
    token: z.uuid(),
    tabId: z.string().min(1).max(128),
    id: z.string().min(1).max(128),
    answer: z
      .object({
        kind: z.literal("credentials"),
        username: z.string().max(4096),
        password: z.string().max(4096),
      })
      .strict(),
  })
  .strict();
export type ScopedAuthAnswer = z.infer<typeof scopedAuthAnswerSchema>;
