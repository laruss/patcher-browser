/**
 * What an rpc call *is*, in one place: validate the input, run the handler,
 * validate the output, and normalize the result to JSON.
 *
 * It lives here rather than in the dispatcher because the dispatcher is no
 * longer the only one running it. A plugin in its own process validates with
 * its own schema objects, which never cross a boundary — the contract carries
 * Standard Schema validators, and a validator is a function. So the plugin
 * process runs this, and the server runs it for a plugin loaded in-process:
 * one copy of the semantics, two places it can execute.
 *
 * The failure shape crosses on its own terms. `PluginRpcBoundaryError` is
 * rebuilt from the wire by name with its `rpcError` field intact
 * (plugin-protocol.ts), so `rpcBoundaryError` matches by name rather than
 * `instanceof` — the class that threw it may be in another process.
 */

import type { JsonValue } from "@patcher/domain";
import type {
  PluginRpcError,
  PluginRpcValidationIssue,
  StandardSchemaV1,
  StandardSchemaV1Issue,
  StandardSchemaV1Result,
} from "@patcher/plugin-sdk";
import type { PluginRpcHandler } from "./plugin-api.js";

export class PluginRpcBoundaryError extends Error {
  constructor(readonly rpcError: PluginRpcError) {
    super(rpcError.message);
    this.name = "PluginRpcBoundaryError";
  }
}

function normalizeRpcIssuePath(
  path: StandardSchemaV1Issue["path"],
): Array<string | number> | undefined {
  if (path === undefined) return undefined;
  const segments = Array.isArray(path) ? path : [path];
  const normalized = segments.map((segment) => {
    const key =
      typeof segment === "object" && segment !== null
        ? Reflect.get(segment, "key")
        : segment;
    return typeof key === "number" ? key : String(key);
  });
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRpcIssues(
  issues: readonly StandardSchemaV1Issue[],
): PluginRpcValidationIssue[] {
  return issues.map((issue) => {
    const path = normalizeRpcIssuePath(issue.path);
    return {
      message: issue.message,
      ...(path !== undefined ? { path } : {}),
    };
  });
}

function rpcBoundaryFailure(
  code: PluginRpcError["code"],
  message: string,
  issues?: PluginRpcValidationIssue[],
): PluginRpcBoundaryError {
  return new PluginRpcBoundaryError({
    code,
    message,
    ...(issues !== undefined ? { issues } : {}),
  });
}

async function validateRpcValue(
  schema: StandardSchemaV1,
  value: unknown,
  phase: "input" | "output",
): Promise<unknown> {
  let result: StandardSchemaV1Result<unknown>;
  try {
    result = await schema["~standard"].validate(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw rpcBoundaryFailure(
      phase === "input" ? "invalid_input" : "invalid_output",
      `rpc ${phase} validator failed: ${detail}`,
      [{ message: detail }],
    );
  }
  if (result.issues !== undefined) {
    const issues = normalizeRpcIssues(result.issues);
    throw rpcBoundaryFailure(
      phase === "input" ? "invalid_input" : "invalid_output",
      `rpc ${phase} validation failed`,
      issues,
    );
  }
  return result.value;
}

/** Strict JsonValue normalization: no coercion, elision, or toJSON hooks. */
function normalizeRpcJsonResult(value: unknown): JsonValue {
  const ancestors = new Set<object>();

  function visit(current: unknown, path: string): JsonValue {
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw rpcBoundaryFailure(
          "non_json_result",
          `rpc result at ${path} contains a non-finite number`,
        );
      }
      return current;
    }
    if (typeof current !== "object") {
      throw rpcBoundaryFailure(
        "non_json_result",
        `rpc result at ${path} is not a JSON value (${typeof current})`,
      );
    }
    if (ancestors.has(current)) {
      throw rpcBoundaryFailure(
        "non_json_result",
        `rpc result at ${path} is cyclic`,
      );
    }
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        return current.map((item, index) => visit(item, `${path}[${index}]`));
      }
      const prototype = Object.getPrototypeOf(current) as object | null;
      if (prototype !== Object.prototype && prototype !== null) {
        throw rpcBoundaryFailure(
          "non_json_result",
          `rpc result at ${path} must be a plain JSON object`,
        );
      }
      const symbolKey = Reflect.ownKeys(current).find(
        (key) => typeof key === "symbol",
      );
      if (symbolKey !== undefined) {
        throw rpcBoundaryFailure(
          "non_json_result",
          `rpc result at ${path} contains a symbol key`,
        );
      }
      const normalized: Record<string, JsonValue> = {};
      for (const [key, child] of Object.entries(current)) {
        normalized[key] = visit(child, `${path}.${key}`);
      }
      return normalized;
    } finally {
      ancestors.delete(current);
    }
  }

  return visit(value, "$result");
}

/**
 * Validate, run, validate, normalize — the whole of an rpc call.
 *
 * Normalization belongs on this side of any boundary: it rejects `undefined`,
 * cycles, class instances and `toJSON` hooks, and a transport that serialized
 * the value first would have quietly resolved all of those before anyone
 * looked.
 */
export async function runRpcCall(
  handler: PluginRpcHandler,
  input: unknown,
): Promise<JsonValue> {
  const parsedInput = await validateRpcValue(
    handler.inputSchema,
    input,
    "input",
  );
  const result = await handler.handler(parsedInput as never);
  const parsedOutput = await validateRpcValue(
    handler.outputSchema,
    result,
    "output",
  );
  return normalizeRpcJsonResult(parsedOutput);
}

/**
 * The rpc failure inside a thrown value, or null if it is an ordinary one.
 *
 * By name and shape, not `instanceof`: the throw may have happened in a plugin
 * process, in which case what the server holds is a rebuilt error carrying the
 * same name and the same `rpcError` field.
 */
export function rpcBoundaryError(thrown: unknown): PluginRpcError | null {
  if (!(thrown instanceof Error) || thrown.name !== "PluginRpcBoundaryError") {
    return null;
  }
  const carried = (thrown as { rpcError?: unknown }).rpcError;
  if (typeof carried !== "object" || carried === null) return null;
  const { code, message } = carried as Partial<PluginRpcError>;
  if (typeof code !== "string" || typeof message !== "string") return null;
  return carried as PluginRpcError;
}

/**
 * A validator that accepts whatever it is given.
 *
 * For a handler whose real contract is enforced in another process: the
 * registration exists on this side so the method can be routed and called, and
 * running the input through a second, weaker check here would only be able to
 * disagree with the real one.
 */
export const alreadyValidatedElsewhere: StandardSchemaV1 = {
  "~standard": {
    version: 1,
    vendor: "patcher-plugin-process",
    validate: (value: unknown) => ({ value }),
  },
};
