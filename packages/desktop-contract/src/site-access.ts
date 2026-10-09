import { z } from "zod";
import { browserCommandSchema } from "@patcher/domain";
import {
  patcherDesktopBrowserPageScriptsSchema,
  patcherDesktopBrowserPageStylesSchema,
} from "./browser.js";

export const SITE_ACCESS_CHANNELS = {
  auth: "patcher-desktop:browser:site-scoped-auth",
  changed: "patcher-desktop:browser:site-access-changed",
  host: "patcher-desktop:browser:site-host",
  execute: "patcher-desktop:browser:site-scoped-command",
  contributions: "patcher-desktop:browser:site-scoped-contributions",
  pageCall: "patcher-desktop:browser:site-scoped-page-call",
  bootstrap: "patcher-desktop:page:site-bootstrap",
  rpc: "patcher-desktop:page:site-rpc",
  restored: "patcher-desktop:page:site-restored",
} as const;
export {
  scopedAuthAnswerSchema,
  type ScopedAuthAnswer,
  siteOriginSchema,
  sitePolicySchema,
  siteContextSchema,
  type DesktopSitePolicy,
  type DesktopSiteContext,
} from "@patcher/domain/plugin-site-access";
export const scopedBrowserCommandSchema = z
  .object({ token: z.uuid(), command: browserCommandSchema })
  .strict();
export type ScopedBrowserCommand = z.infer<typeof scopedBrowserCommandSchema>;
export const scopedPageCallSchema = z
  .object({
    token: z.uuid(),
    callId: z.string().min(1).max(128),
    pluginId: z.string().min(1).max(128),
    method: z.string().min(1).max(256),
    input: z.string().max(65536),
  })
  .strict();
export type ScopedPageCall = z.infer<typeof scopedPageCallSchema>;
export const scopedPageContributionsSchema = z
  .object({
    scripts: patcherDesktopBrowserPageScriptsSchema.shape.scripts,
    styles: patcherDesktopBrowserPageStylesSchema.shape.styles,
  })
  .strict();
export type ScopedPageContributions = z.infer<
  typeof scopedPageContributionsSchema
>;

export interface RuntimeSiteBrowserApi {
  respondToScopedAuth?(
    request: import("@patcher/domain/plugin-site-access").ScopedAuthAnswer,
  ): Promise<boolean>;
  onSiteAccessChanged?(listener: () => void): () => void;
  getScopedHostId?(): Promise<number>;
  executeScopedCommand?: (
    request: import("./site-access.js").ScopedBrowserCommand,
  ) => Promise<import("@patcher/domain").BrowserCommandOutcome>;
  setScopedPageContributions?: (
    request: import("./site-access.js").ScopedPageContributions,
  ) => void;
  onScopedPageScriptCall?: (
    listener: (call: import("./site-access.js").ScopedPageCall) => void,
  ) => () => void;
}
