/**
 * Types for the build script beside this file, so a test can read the manifest.
 *
 * `bundle-manifest.mjs` is plain JavaScript because esbuild's build and check
 * scripts import it directly, and `src/bundle-manifest.test.ts` reads it to
 * hold the emitted bundles against what the published package carries.
 */
export interface HostDaemonBundleTarget {
  banner: string;
  entryPoint: string;
  label: string;
  outfile: string;
  executable?: boolean;
  externalPackages?: readonly string[];
  bundledPackages?: readonly string[];
  requiredLiterals?: readonly string[];
}

export declare const NODE_ESM_REQUIRE_BANNER: string;
export declare const bundleTargets: readonly HostDaemonBundleTarget[];
