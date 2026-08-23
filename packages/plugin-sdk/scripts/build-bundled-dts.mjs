// Generates the self-contained `.d.ts` bundles that `patcher plugin new` ships into
// a scaffolded plugin's `types/` directory, so authors get real PatcherPluginApi /
// @patcher/plugin-sdk/app types WITHOUT the (unpublished) @patcher/* workspace packages
// on disk.
//
// rollup-plugin-dts flattens @patcher/plugin-sdk's own contracts plus every @patcher/*
// type it references (PatcherSdk, PromptInput, ThreadResponse, …) into the root
// file. Testing subpaths reuse that already-portable root declaration through
// the package's own public name instead of flattening the same contracts a
// second time. Genuine npm packages remain external imports and resolve from
// the consumer's own dependencies.
//
// The output is committed as bundled-types/*.d.ts (read at scaffold time by
// @patcher/templates via file path — no package edge, to avoid a dependency cycle).
// Run with --check to fail (in CI/typecheck) when the committed copy is stale.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const pkgsDir = path.resolve(pkgRoot, "..");
const publicApiModule = path.join(pkgsDir, "server-contract/src/public-api.ts");
const publicApiStub = path.join(here, "public-api-stub.d.ts");
const outDir = path.join(pkgRoot, "bundled-types");
const outputs = {
  "patcher-plugin-sdk.d.ts": path.join(pkgRoot, "src/index.ts"),
  "patcher-plugin-sdk-app.d.ts": path.join(pkgRoot, "src/app.ts"),
  "patcher-plugin-sdk-internal-composer-customization-validation.d.ts":
    path.join(pkgRoot, "src/internal/composer-customization-validation.ts"),
  "patcher-plugin-sdk-internal-composer-view.d.ts": path.join(
    pkgRoot,
    "src/internal/composer-view.ts",
  ),
  "patcher-plugin-sdk-testing.d.ts": path.join(pkgRoot, "src/testing/index.ts"),
  "patcher-plugin-sdk-testing-app.d.ts": path.join(
    pkgRoot,
    "src/testing/app.tsx",
  ),
};

// Real npm packages the bundle imports from — kept external so they resolve
// from the scaffold's devDependencies rather than being inlined.
const EXTERNAL = [
  /^@patcher\/plugin-sdk$/,
  /^@testing-library\/react($|\/)/,
  /^better-sqlite3/,
  /^hono($|\/)/,
  /^react($|\/|-)/,
  /^react-dom($|\/)/,
  /^zod($|\/)/,
];

/** Resolve any `@patcher/<pkg>[/<sub>]` to its `source` export target on disk. */
function resolvePatcherSource(id) {
  const match = /^@patcher\/([^/]+)(\/.*)?$/.exec(id);
  if (!match) return null;
  const pkgDir = path.join(pkgsDir, match[1]);
  const manifestPath = path.join(pkgDir, "package.json");
  if (!existsSync(manifestPath)) return null;
  const { exports } = JSON.parse(readFileSync(manifestPath, "utf8"));
  const key = match[2] ? "." + match[2] : ".";
  const entry = exports?.[key];
  const source =
    typeof entry === "string"
      ? entry
      : (entry?.source ?? entry?.types ?? entry?.default);
  return source ? path.join(pkgDir, source) : null;
}

const inlineWorkspace = {
  name: "inline-patcher-workspace",
  resolveId(id, importer) {
    // Redirect server-contract's non-portable route table to the loose stub,
    // whether imported by bare specifier or by its own barrel's relative path.
    if (importer) {
      const asTs = path.resolve(
        path.dirname(importer),
        id.replace(/\.js$/, ".ts"),
      );
      if (asTs === publicApiModule) return publicApiStub;
    }
    if (id === publicApiModule) return publicApiStub;
    return resolvePatcherSource(id);
  },
};

async function bundle(input) {
  const build = await rollup({
    input,
    external: EXTERNAL,
    // Load one file at a time. TypeScript emits the members of an inferred
    // object type in the order it interned them, so a concurrent load order
    // made the declaration bytes vary run to run while the types stayed
    // identical — a real one-line change arrived buried in dozens of unrelated
    // swaps. Sequential loading fixes the cause: measured 6 clean regenerations
    // byte-identical with no normalization at all, against roughly one in three
    // differing without it. It costs about a second on this graph.
    //
    // Note the name: `maxParallelFileOperations` is silently accepted as an
    // unknown option and does nothing.
    maxParallelFileOps: 1,
    plugins: [inlineWorkspace, dts({ respectExternal: false })],
    onwarn(warning) {
      // Circular type references are fine in .d.ts output; surface everything
      // else so a genuinely broken bundle is visible.
      if (warning.code === "CIRCULAR_DEPENDENCY") return;
      console.warn(`[build-bundled-dts] ${warning.code}: ${warning.message}`);
    },
  });
  const { output } = await build.generate({ format: "es" });
  await build.close();
  return output[0].code;
}

const HEADER = [
  "// Portable type declarations for `@patcher/plugin-sdk`. Unpublished Patcher",
  "// workspace contracts are flattened; public subpaths may reuse the",
  "// package root without requiring any other @patcher/* package.",
  "//",
  "// Confused by the API, or need a symbol that isn't here? Clone the Patcher repo",
  "// and read the real source: https://github.com/laruss/patcher-browser",
].join("\n");

const generated = {};
for (const [fileName, entry] of Object.entries(outputs)) {
  generated[fileName] = `${HEADER}\n\n${await bundle(entry)}`;
}

/**
 * What the staleness check treats as "the same declaration".
 *
 * Sequential loading above makes emission deterministic, so this is a belt to
 * that brace rather than the fix: it absorbs the two constructs whose order
 * carries no meaning, in case a different toolchain or platform reorders them
 * anyway. A literal union on one line, and a run of *inferred* members — a
 * member typed by a `z.*` reference, or a literal key -> same-literal entry,
 * which is what `z.enum` emits.
 *
 * Deliberately narrow. It used to compare the sorted line multiset of the whole
 * file, which passes for any reordering whatsoever: a member moved from one
 * interface into another was invisible to it. Hand-written interfaces are now
 * compared where their author put them.
 */
function canonicalize(content) {
  return sortInferredMembers(sortLiteralUnions(content));
}

// Comparison only: the written bytes stay in the order the compiler emitted
// them, which is deterministic now and readable — these files ship into
// scaffolded plugins for people to read, so alphabetizing them would cost more
// than it buys.

/** `"b" | "a"` -> `"a" | "b"`. Union member order carries no meaning. */
function sortLiteralUnions(content) {
  return content.replace(
    /"(?:[^"\\]|\\.)+"(?: \| "(?:[^"\\]|\\.)+")+/gu,
    (union) => union.split(" | ").sort().join(" | "),
  );
}

/**
 * A complete one-line object member: `name: type;`, optionally `readonly` and
 * optionally `?`. Balanced-bracket check below keeps multi-line members out.
 */
const MEMBER =
  /^(\s*)(?:readonly )?(?:"((?:[^"\\]|\\.)+)"|([A-Za-z_$][\w$]*))\??: (.+);$/u;

function inferredMember(line) {
  const match = MEMBER.exec(line);
  if (match === null) return null;
  const [, indent, quotedKey, bareKey, type] = match;
  // A member whose value spans lines cannot be moved on its own.
  if (!isBalanced(type)) return null;
  const key = quotedKey ?? bareKey;
  const isZodType = /^z\$?\d*\./u.test(type);
  const isLiteralSelfMap = type === `"${key}"`;
  return isZodType || isLiteralSelfMap ? { indent } : null;
}

function isBalanced(text) {
  const pairs = { ")": "(", "]": "[", "}": "{", ">": "<" };
  const stack = [];
  for (const character of text) {
    if ("([{<".includes(character)) stack.push(character);
    else if (character in pairs && stack.pop() !== pairs[character])
      return false;
  }
  return stack.length === 0;
}

/** Sort each maximal run of same-indent inferred members in place. */
function sortInferredMembers(content) {
  const lines = content.split("\n");
  let start = 0;
  while (start < lines.length) {
    const first = inferredMember(lines[start]);
    if (first === null) {
      start += 1;
      continue;
    }
    let end = start + 1;
    while (end < lines.length) {
      const next = inferredMember(lines[end]);
      if (next === null || next.indent !== first.indent) break;
      end += 1;
    }
    if (end - start > 1) {
      const run = lines.slice(start, end);
      run.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
      lines.splice(start, run.length, ...run);
    }
    start = end;
  }
  return lines.join("\n");
}

const check = process.argv.includes("--check");
let stale = false;
if (!check) mkdirSync(outDir, { recursive: true });

for (const [fileName, content] of Object.entries(generated)) {
  const target = path.join(outDir, fileName);
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  const unchanged =
    current !== null && canonicalize(current) === canonicalize(content);
  if (check) {
    if (!unchanged) {
      console.error(
        `bundled-types/${fileName} is stale. Run \`bun run --filter @patcher/plugin-sdk build\`.`,
      );
      stale = true;
    }
  } else if (unchanged) {
    console.log(`Unchanged ${path.relative(pkgRoot, target)}`);
  } else {
    writeFileSync(target, content);
    console.log(`Wrote ${path.relative(pkgRoot, target)}`);
  }
}

if (check) {
  if (stale) process.exit(1);
  console.log("bundled-types/*.d.ts are up to date.");
}
