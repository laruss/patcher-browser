// Portable type declarations for `@patcher/plugin-sdk`. Unpublished Patcher
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @patcher/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the Patcher repo
// and read the real source: https://github.com/laruss/patcher-browser

import { ComposerCustomization, PluginBrowserTabStatus, PluginComposerThreadRowStatus } from '@patcher/plugin-sdk';

declare const PLUGIN_SLOT_ID_PATTERN: RegExp;
type RejectionReporter = (reason: string) => void;
/**
 * Parse the runtime value handed to
 * `PluginContentScriptContext.experimental_setThreadRowStatus`. `undefined`
 * means the value was rejected; `null` remains the explicit clear operation.
 */
declare function normalizePluginThreadRowStatus(value: unknown, onRejected: RejectionReporter): PluginComposerThreadRowStatus | null | undefined;
/**
 * Parse the runtime value handed to
 * `PluginContentScriptContext.experimental_setBrowserTabStatus`, on the same
 * terms as {@link normalizePluginThreadRowStatus}.
 */
declare function normalizePluginBrowserTabStatus(value: unknown, onRejected: RejectionReporter): PluginBrowserTabStatus | null | undefined;
declare function requireSlotId(kind: string, value: unknown): string;
declare function requireMessageDirectiveId(kind: string, value: unknown): string;
declare function requireNonEmptyString(kind: string, field: string, value: unknown): string;
declare function requireOptionalString(kind: string, field: string, value: unknown): string | undefined;
declare function requireComponent<T>(kind: string, value: unknown): T;
declare function requireUniqueId(kind: string, seen: Set<string>, id: string): void;
/**
 * Validate one registration while isolating composer customization failures.
 * The host and test harness inject their own rejection reporters.
 */
declare function collectComposerCustomization(registration: unknown, seenIds: Set<string>, onRejected: RejectionReporter): ComposerCustomization | null;

export { PLUGIN_SLOT_ID_PATTERN, collectComposerCustomization, normalizePluginBrowserTabStatus, normalizePluginThreadRowStatus, requireComponent, requireMessageDirectiveId, requireNonEmptyString, requireOptionalString, requireSlotId, requireUniqueId };
