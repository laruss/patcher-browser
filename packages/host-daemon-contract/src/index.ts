export * from "./commands.js";
export * from "./common.js";
export * from "./local-state.js";
export * from "./local.js";
export * from "./session.js";

export { typedRoutes } from "@patcher/hono-typed-routes";

// Selected re-exports from @patcher/domain so contract consumers don't need a
// direct @patcher/domain dependency. Keep these explicit: starring another
// package's barrel would absorb its entire surface.
export {
  TERMINAL_COLS_MAX,
  TERMINAL_DATA_MAX_BASE64_LENGTH,
  TERMINAL_DATA_MAX_BYTES,
  TERMINAL_ROWS_MAX,
} from "@patcher/domain";
