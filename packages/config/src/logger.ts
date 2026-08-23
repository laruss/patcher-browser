import {
  loadCommonConfig,
  loadLogLevelConfig,
  type LoadCommonConfigArgs,
  type LogLevelConfig,
} from "./common.js";

export interface LoggerConfig extends LogLevelConfig {
  PATCHER_DATA_DIR: string;
}

export interface LoadLoggerConfigArgs extends LoadCommonConfigArgs {
  dataDir?: string;
}

export function loadLoggerConfig(
  args: LoadLoggerConfigArgs = {},
): LoggerConfig {
  if (args.dataDir !== undefined) {
    return {
      ...loadLogLevelConfig(args),
      PATCHER_DATA_DIR: args.dataDir,
    };
  }

  return loadCommonConfig(args);
}
