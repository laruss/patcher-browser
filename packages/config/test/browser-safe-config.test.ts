import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The subpaths of this package the SPA is allowed to import, and the one thing
 * that has to be true of them: nothing under them may reach `node:`.
 *
 * Vite externalizes a Node builtin rather than failing the build, so the cost
 * lands on the user as a white screen and an "Module node:crypto has been
 * externalized" in the console — at the first access, which for the app key is
 * the first request it makes. That is how `app-key.ts` shipped `node:fs`,
 * `node:path` and (through `runtime.ts`) `node:crypto` into the browser bundle
 * while every suite stayed green: vitest runs in Node, where all three resolve.
 *
 * So this is a source-level guard rather than a test of behaviour. It walks the
 * relative imports out of each entry — the graph the bundler walks — and fails
 * on the first `node:` specifier it finds, naming the path that got there.
 */
const BROWSER_SAFE_ENTRIES = ["app-key.ts", "app-surface.ts"] as const;

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Every specifier a module imports or re-exports, type-only ones included. */
function importedSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:^|\n)\s*(?:import|export)[^;]*?from\s*["']([^"']+)["']/g,
    ),
    ...source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
}

interface NodeReach {
  /** How the walk got there, entry first. */
  path: string[];
  specifier: string;
}

function findNodeImport(entry: string): NodeReach | null {
  const seen = new Set<string>();
  const queue: Array<{ file: string; path: string[] }> = [
    { file: join(SRC_DIR, entry), path: [entry] },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || seen.has(current.file)) {
      continue;
    }
    seen.add(current.file);
    const source = readFileSync(current.file, "utf8");
    for (const specifier of importedSpecifiers(source)) {
      if (specifier.startsWith("node:")) {
        return { path: current.path, specifier };
      }
      if (!specifier.startsWith(".")) {
        // A package, not this one's own source. Whether *it* is browser-safe is
        // its own package's business, and the SPA's bundler already resolves it
        // by the "browser" condition.
        continue;
      }
      const resolved = join(
        dirname(current.file),
        specifier.replace(/\.js$/, ".ts"),
      );
      queue.push({ file: resolved, path: [...current.path, specifier] });
    }
  }
  return null;
}

describe("config subpaths the SPA imports", () => {
  for (const entry of BROWSER_SAFE_ENTRIES) {
    it(`keeps ${entry} free of Node, transitively`, () => {
      const reach = findNodeImport(entry);
      expect(
        reach,
        reach === null
          ? ""
          : `${reach.path.join(" -> ")} imports ${reach.specifier}; the SPA imports this subpath, and Vite turns a Node builtin into a white screen`,
      ).toBeNull();
    });
  }

  // The other half of the split: the Node side still exists and still reads the
  // file, so the guard above cannot be satisfied by deleting the capability.
  it("keeps reading the key file on the Node side", () => {
    const source = readFileSync(join(SRC_DIR, "app-key-file.ts"), "utf8");

    expect(source).toContain('from "node:fs"');
    expect(source).toContain("export function resolveAppApiKey");
  });
});
