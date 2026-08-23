import type { FeatureFlags } from "@patcher/domain";
import {
  readEnvVarWithDefault,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import {
  PATCHER_FF_PLACEHOLDER_ENV,
  PATCHER_FF_TIMELINE_WINDOW_EVENT_BUDGET_ENV,
  DEFAULT_PATCHER_FF_PLACEHOLDER,
  DEFAULT_PATCHER_FF_TIMELINE_WINDOW_EVENT_BUDGET,
} from "./env-vars.js";

export type LoadFeatureFlagsArgs = EnvLoaderArgs;

export function loadFeatureFlags(
  args: LoadFeatureFlagsArgs = {},
): FeatureFlags {
  const loader = resolveEnvLoader(args);
  return {
    placeholder: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_PATCHER_FF_PLACEHOLDER,
      definition: PATCHER_FF_PLACEHOLDER_ENV,
      env: loader.env,
    }),
    timelineWindowEventBudget: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_PATCHER_FF_TIMELINE_WINDOW_EVENT_BUDGET,
      definition: PATCHER_FF_TIMELINE_WINDOW_EVENT_BUDGET_ENV,
      env: loader.env,
    }),
  };
}
