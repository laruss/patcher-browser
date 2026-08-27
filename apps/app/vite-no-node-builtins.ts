import type { Plugin } from "vite";

/**
 * Fails the app build — and a dev request — when anything in the SPA's module
 * graph imports a Node builtin.
 *
 * Vite's own answer to `node:crypto` in browser code is to externalize it and
 * print a warning, then finish the build with exit code 0. Nothing downstream
 * reads that warning: CI runs `build typecheck lint`, the boot-payload budget
 * measures bytes, the packaged smoke drives the Electron shell against a stub
 * page, and every vitest suite runs *in Node*, where the builtin resolves for
 * real. So the whole chain stays green while the shipped app dies on the first
 * access to the externalized module with a white screen and one console line.
 *
 * That is not hypothetical: `@patcher/config/app-key` carried `node:fs`,
 * `node:path` and (through `runtime.ts`) `node:crypto` into the bundle because
 * the SPA imported a header name from it, and it took a human opening the app
 * to find out. This turns the warning nobody reads into the error nobody can
 * merge past.
 *
 * Scope is the client graph only: `ssr` resolutions and Vite's own config and
 * plugins run in Node and are none of this plugin's business. If a dependency
 * ever needs a builtin behind a browser-safe branch, the deliberate fix is an
 * entry in `allow`, not the removal of this plugin.
 */
export function noNodeBuiltins(options: { allow?: readonly string[] } = {}) {
  const allow = new Set(options.allow ?? []);
  return {
    name: "patcher:no-node-builtins",
    enforce: "pre",
    // Node builtins reach a bundler as either `node:fs` or a bare `fs`. The
    // prefixed form is what current source uses; the bare form is what an older
    // dependency still ships, and both externalize the same way.
    resolveId(source: string, importer: string | undefined, resolveOptions) {
      if (resolveOptions?.ssr === true) {
        return null;
      }
      const builtin = source.startsWith("node:")
        ? source
        : BARE_NODE_BUILTINS.has(source)
          ? `node:${source}`
          : null;
      if (builtin === null || allow.has(builtin) || allow.has(source)) {
        return null;
      }
      throw new Error(
        [
          `${importer ?? "the app"} imports ${source}, which the browser has no answer for.`,
          "Vite would externalize it and the app would die on first access —",
          "a white screen and one console line, with every suite still green.",
          "Move the Node half behind its own module (see packages/config/src/app-key-file.ts),",
          "or, if a dependency needs the builtin behind a browser-safe branch,",
          "add it to the `allow` list on patcher:no-node-builtins and say why.",
        ].join(" "),
      );
    },
  } satisfies Plugin;
}

/** Every Node builtin, unprefixed — the spelling an older package still uses. */
const BARE_NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);
