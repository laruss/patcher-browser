import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bundleTargets } from "../scripts/bundle-manifest.mjs";

/**
 * What the daemon builds, against what the published package carries.
 *
 * These two lists are written in different files by different concerns — one
 * says what esbuild emits, the other says what npm packs — and nothing else
 * notices when they disagree. A bundle missing from the second one builds
 * fine, passes every test, and is simply absent on an installed machine, where
 * the first process that needs it fails at a moment nobody would connect to
 * the omission. The sandbox net relay is exactly such a file: it is spawned
 * only by a Linux turn that confines its network.
 */

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workspaceRoot = path.resolve(packageRoot, "..", "..");

interface PublishedPackage {
  files: string[];
}

function publishedFiles(): string[] {
  const manifest = JSON.parse(
    readFileSync(
      path.join(workspaceRoot, "packages", "patcher-app", "package.json"),
      "utf8",
    ),
  ) as PublishedPackage;
  return manifest.files;
}

describe("every bundle the daemon emits", () => {
  it("is carried by the published package", () => {
    const packed = new Set(publishedFiles());

    const missing = bundleTargets
      .map((target) =>
        path
          .relative(path.join(packageRoot, "dist"), target.outfile)
          .replaceAll(path.sep, "/"),
      )
      .filter((name) => !packed.has(`host-daemon/dist/${name}`));

    expect(missing).toEqual([]);
  });
});
