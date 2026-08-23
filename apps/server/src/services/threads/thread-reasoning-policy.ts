import {
  getAgentProviderServerCapabilities,
} from "@patcher/agent-providers";
import type { ReasoningLevel } from "@patcher/domain";

/**
 * The coarse, per-provider reasoning levels. Used as a fallback when a precise
 * per-model `supportedReasoningEfforts` set is unavailable (e.g. validating a
 * reasoning override against a legacy/selected-only model not in the active
 * catalog). Returns an empty list for unknown providers. The per-provider
 * ladder itself is declared in the `@patcher/agent-providers` catalog.
 */
export function getSupportedReasoningLevelsForProvider(
  providerId: string,
): readonly ReasoningLevel[] {
  return getAgentProviderServerCapabilities(providerId)?.reasoningLevels ?? [];
}
