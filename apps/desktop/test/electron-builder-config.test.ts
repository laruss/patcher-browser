import { spawn } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createDesktopReleaseInfo,
  DESKTOP_AUTO_UPDATE_FEED_CONFIG,
} from "../src/desktop-update-provider.js";

const desktopPackageRoot = process.cwd();

/**
 * The `Info.plist` additions that make macOS treat the bundle as a browser.
 * Parsed on its own because `macConfigSchema` passes unknown keys through
 * untyped, and these are the keys the OS reads rather than electron-builder.
 */
const macExtendInfoSchema = z
  .object({
    CFBundleURLTypes: z.array(
      z
        .object({ CFBundleURLSchemes: z.array(z.string().min(1)) })
        .passthrough(),
    ),
    NSUserActivityTypes: z.array(z.string().min(1)),
  })
  .passthrough();

const macConfigSchema = z
  .object({
    entitlements: z.string().min(1),
    entitlementsInherit: z.string().min(1),
    gatekeeperAssess: z.literal(false),
    hardenedRuntime: z.literal(true),
    icon: z.string().min(1),
    identity: z.string().nullable().optional(),
    notarize: z.boolean(),
  })
  .passthrough();

const electronBuilderFileSetSchema = z
  .object({
    filter: z.array(z.string().min(1)),
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .passthrough();

const electronBuilderFilePatternSchema = z.union([
  z.string().min(1),
  electronBuilderFileSetSchema,
]);

const electronBuilderConfigSchema = z
  .object({
    afterPack: z.string().min(1),
    asarUnpack: z.array(z.string().min(1)),
    dmg: z
      .object({
        sign: z.boolean(),
      })
      .passthrough(),
    files: z.array(electronBuilderFilePatternSchema),
    mac: macConfigSchema,
    npmRebuild: z.literal(false),
    appId: z.string().min(1),
    artifactName: z.string().min(1),
    productName: z.string().min(1),
    publish: z.tuple([
      z
        .object({
          channel: z.enum(["latest", "nightly"]),
          provider: z.literal("generic"),
          url: z.string().min(1),
        })
        .passthrough(),
    ]),
  })
  .passthrough();

const desktopPackageJsonSchema = z
  .object({
    main: z.literal("dist/main.js"),
    // Optional: the desktop app no longer pins per-architecture plugin build
    // binaries, so it may declare none at all.
    optionalDependencies: z.record(z.string(), z.string()).optional(),
    type: z.never().optional(),
  })
  .passthrough();

/**
 * Per-arch macOS prebuilds the *checkout* needs available to resolve — not
 * something the packaged app ships (see "ships no plugin build toolchain
 * binaries" above). `node-pty` carries every prebuild in one tarball, but
 * esbuild, sharp and rollup publish one package per platform+arch, so the
 * lockfile has to name both macOS arches for the repo to install on Intel and
 * Apple Silicon alike.
 */
const CROSS_ARCH_PREBUILD_PACKAGES = [
  "@esbuild/darwin-arm64",
  "@esbuild/darwin-x64",
  "@img/sharp-darwin-arm64",
  "@img/sharp-darwin-x64",
  "@rollup/rollup-darwin-arm64",
  "@rollup/rollup-darwin-x64",
];

const signingEnvironmentKeys = [
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_ID",
  "APPLE_TEAM_ID",
  "CSC_IDENTITY_AUTO_DISCOVERY",
  "CSC_KEY_PASSWORD",
  "CSC_LINK",
  "CSC_NAME",
];
const audioInputEntitlementPattern =
  /<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\s*\/>/u;

type ElectronBuilderConfig = z.infer<typeof electronBuilderConfigSchema>;
type EnvironmentOverrides = Record<string, string | undefined>;
type ScriptRunResult = {
  exitCode: number | null;
  stderr: string;
  stdout: string;
};
type ReadResolvedConfigResult = {
  config: ElectronBuilderConfig;
};
type CreateScriptEnvironment = (
  overrides: EnvironmentOverrides,
) => NodeJS.ProcessEnv;
type RunConfigScript = (
  overrides: EnvironmentOverrides,
) => Promise<ScriptRunResult>;
type ReadResolvedConfig = (
  overrides: EnvironmentOverrides,
) => Promise<ReadResolvedConfigResult>;
type RunNativePrepScript = (appOutDir: string) => Promise<ScriptRunResult>;

const createScriptEnvironment: CreateScriptEnvironment = (overrides) => {
  const env = { ...process.env };

  for (const key of signingEnvironmentKeys) {
    delete env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
};

const runConfigScript: RunConfigScript = async (overrides) => {
  const child = spawn(
    process.execPath,
    ["scripts/run-electron-builder.mjs", "--print-config"],
    {
      cwd: desktopPackageRoot,
      env: createScriptEnvironment(overrides),
    },
  );
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  child.stdout.on("data", (chunk) => {
    stdoutChunks.push(String(chunk));
  });
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(String(chunk));
  });

  const exitCode = await new Promise<number | null>((resolveExitCode) => {
    child.on("close", resolveExitCode);
  });

  return {
    exitCode,
    stderr: stderrChunks.join(""),
    stdout: stdoutChunks.join(""),
  };
};

const runNativePrepScript: RunNativePrepScript = async (appOutDir) => {
  const child = spawn(
    process.execPath,
    ["scripts/prepare-native-modules.cjs", appOutDir],
    {
      cwd: desktopPackageRoot,
    },
  );
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  child.stdout.on("data", (chunk) => {
    stdoutChunks.push(String(chunk));
  });
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(String(chunk));
  });

  const exitCode = await new Promise<number | null>((resolveExitCode) => {
    child.on("close", resolveExitCode);
  });

  return {
    exitCode,
    stderr: stderrChunks.join(""),
    stdout: stdoutChunks.join(""),
  };
};

const readResolvedConfig: ReadResolvedConfig = async (overrides) => {
  const result = await runConfigScript(overrides);

  expect(result.exitCode).toBe(0);
  return {
    config: electronBuilderConfigSchema.parse(JSON.parse(result.stdout)),
  };
};

describe("electron-builder signing config", () => {
  it("keeps package metadata compatible with electron universal's CJS entry asar", async () => {
    const packageJsonText = await readFile(
      resolve(desktopPackageRoot, "package.json"),
      "utf8",
    );
    const packageJson = desktopPackageJsonSchema.parse(
      JSON.parse(packageJsonText),
    );

    expect(packageJson.main).toBe("dist/main.js");
    expect(packageJson).not.toHaveProperty("type");
  });

  it("ships no plugin build toolchain binaries", async () => {
    // The toolchain is fetched into the data dir on first plugin build, so
    // the packaged app must not carry per-architecture esbuild/oxide binaries.
    const packageJsonText = await readFile(
      resolve(desktopPackageRoot, "package.json"),
      "utf8",
    );
    const packageJson = desktopPackageJsonSchema.parse(
      JSON.parse(packageJsonText),
    );

    expect(Object.keys(packageJson.optionalDependencies ?? {})).not.toEqual(
      expect.arrayContaining(["@esbuild/darwin-arm64", "@esbuild/darwin-x64"]),
    );
  });

  it("unpacks the ESM patcher-app bridge with an explicit module extension", async () => {
    const configText = await readFile(
      resolve(desktopPackageRoot, "electron-builder.config.json"),
      "utf8",
    );
    const config = electronBuilderConfigSchema.parse(JSON.parse(configText));

    expect(config.asarUnpack).toContain("dist/patcher-app-bridge.mjs");
    expect(config.asarUnpack).not.toContain("dist/patcher-app-bridge.js");
  });

  it("runs a native module preparation hook after packaging", async () => {
    const configText = await readFile(
      resolve(desktopPackageRoot, "electron-builder.config.json"),
      "utf8",
    );
    const config = electronBuilderConfigSchema.parse(JSON.parse(configText));
    const hookPath = "scripts/prepare-native-modules.cjs";

    expect(config.afterPack).toBe(hookPath);
    await expect(
      access(resolve(desktopPackageRoot, hookPath)),
    ).resolves.toBeUndefined();
  });

  it("locks native prebuild packages for both macOS arches", async () => {
    // Under pnpm this guarantee came from `pnpm.supportedArchitectures`
    // (cpu: arm64 + x64), which physically installed both arches everywhere.
    // Bun's lockfile is platform-agnostic instead: it records every optional
    // prebuild variant and each machine extracts only its own, so the property
    // worth asserting moved from "both installed" to "both locked". Losing it
    // would leave a checkout uninstallable on one of the two macOS arches.
    const lockText = await readFile(
      resolve(desktopPackageRoot, "..", "..", "bun.lock"),
      "utf8",
    );

    for (const packageName of CROSS_ARCH_PREBUILD_PACKAGES) {
      expect(lockText).toContain(`"${packageName}@`);
    }
  });

  it("disables in-place native rebuilds so the shared package store is not mutated", async () => {
    // electron-builder's npmRebuild rebuilds better-sqlite3 through the
    // workspace symlink into the shared content-addressed store (node_modules/.bun,
    // previously node_modules/.pnpm), flipping the binary to Electron's ABI and
    // breaking every plain-node consumer (the server test suite). The afterPack
    // hook fetches the Electron prebuild into the packaged copy instead, so this
    // must stay false.
    const configText = await readFile(
      resolve(desktopPackageRoot, "electron-builder.config.json"),
      "utf8",
    );
    const config = electronBuilderConfigSchema.parse(JSON.parse(configText));

    expect(config.npmRebuild).toBe(false);
  });

  it("excludes source maps from packaged app files", async () => {
    const configText = await readFile(
      resolve(desktopPackageRoot, "electron-builder.config.json"),
      "utf8",
    );
    const config = electronBuilderConfigSchema.parse(JSON.parse(configText));

    expect(config.files).toContain("!**/*.map");
  });

  it("copies the app scaffold template as a dedicated file set", async () => {
    const configText = await readFile(
      resolve(desktopPackageRoot, "electron-builder.config.json"),
      "utf8",
    );
    const config = electronBuilderConfigSchema.parse(JSON.parse(configText));

    // electron-builder prunes *.d.ts while collecting node_modules. The
    // scaffold source is user-editable template content, so copy that subtree
    // separately without relaxing dependency pruning for the rest of node_modules.
    expect(config.files).toContainEqual({
      filter: ["**/*"],
      from: "node_modules/patcher-app/server/dist/app-scaffold-template",
      to: "node_modules/patcher-app/server/dist/app-scaffold-template",
    });
  });

  it("patches packaged node-pty helper path handling", async () => {
    const appOutDir = await mkdtemp(
      resolve(tmpdir(), "patcher-desktop-native-modules-"),
    );
    const nodePtyPackageDir = resolve(
      appOutDir,
      "patcher.app",
      "Contents",
      "Resources",
      "app.asar.unpacked",
      "node_modules",
      "node-pty",
    );
    const rebuiltNativeDir = resolve(nodePtyPackageDir, "build", "Release");
    const unixTerminalPath = resolve(
      nodePtyPackageDir,
      "lib",
      "unixTerminal.js",
    );
    const helperPath = resolve(
      nodePtyPackageDir,
      "prebuilds",
      "darwin-arm64",
      "spawn-helper",
    );
    const rebuiltHelperPath = resolve(rebuiltNativeDir, "spawn-helper");

    try {
      await mkdir(rebuiltNativeDir, { recursive: true });
      await writeFile(resolve(rebuiltNativeDir, "pty.node"), "rebuilt");
      await writeFile(rebuiltHelperPath, "rebuilt-helper");
      await chmod(rebuiltHelperPath, 0o644);
      await mkdir(dirname(unixTerminalPath), { recursive: true });
      await writeFile(
        unixTerminalPath,
        "helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');",
      );
      await mkdir(dirname(helperPath), { recursive: true });
      await writeFile(helperPath, "helper");
      await chmod(helperPath, 0o644);
      const result = await runNativePrepScript(appOutDir);

      expect(result.exitCode).toBe(0);
      await expect(
        access(resolve(rebuiltNativeDir, "pty.node")),
      ).resolves.toBeUndefined();
      await expect(readFile(unixTerminalPath, "utf8")).resolves.toContain(
        "helperPath.replace(/app\\.asar(?!\\.unpacked)/g, 'app.asar.unpacked')",
      );
      expect((await stat(helperPath)).mode & 0o777).toBe(0o755);
      expect((await stat(rebuiltHelperPath)).mode & 0o777).toBe(0o755);
    } finally {
      await rm(appOutDir, { force: true, recursive: true });
    }
  });

  it("points mac signing entitlements at checked-in plist files", async () => {
    const configText = await readFile(
      resolve(desktopPackageRoot, "electron-builder.config.json"),
      "utf8",
    );
    const config = electronBuilderConfigSchema.parse(JSON.parse(configText));

    expect(config.mac.entitlements).toBe("build/entitlements.mac.plist");
    expect(config.mac.entitlementsInherit).toBe(
      "build/entitlements.mac.inherit.plist",
    );

    await expect(
      access(resolve(desktopPackageRoot, config.mac.entitlements)),
    ).resolves.toBeUndefined();
    await expect(
      access(resolve(desktopPackageRoot, config.mac.entitlementsInherit)),
    ).resolves.toBeUndefined();
  });

  it("grants audio input to the signed app and helper processes", async () => {
    const configText = await readFile(
      resolve(desktopPackageRoot, "electron-builder.config.json"),
      "utf8",
    );
    const config = electronBuilderConfigSchema.parse(JSON.parse(configText));
    const entitlementPaths = [
      config.mac.entitlements,
      config.mac.entitlementsInherit,
    ];

    for (const entitlementPath of entitlementPaths) {
      const entitlements = await readFile(
        resolve(desktopPackageRoot, entitlementPath),
        "utf8",
      );

      expect(entitlements).toMatch(audioInputEntitlementPattern);
    }
  });

  it("declares the URL schemes macOS builds its default-browser list from", async () => {
    // macOS decides what a browser is in Launch Services, not from what the app
    // can render: a bundle reaches the "Default web browser" list only by
    // declaring both `http` and `https`. `Info.plist` cannot be written at
    // runtime, so this declaration is also what makes
    // `app.setAsDefaultProtocolClient` legal for those two schemes — without it
    // the call fails whatever the user picked in Settings.
    //
    // Deliberately no `CFBundleDocumentTypes`: declaring `public.html` would
    // make Patcher the opener for local HTML files, and the browsed view refuses
    // `file:` (`isAllowedBrowserUrl`), so a double-clicked document would open
    // a window that shows nothing.
    for (const channel of ["latest", "nightly"]) {
      const { config } = await readResolvedConfig({
        PATCHER_DESKTOP_RELEASE_CHANNEL: channel,
      });
      const extendInfo = macExtendInfoSchema.parse(config.mac.extendInfo);

      expect(
        extendInfo.CFBundleURLTypes.flatMap(
          (urlType) => urlType.CFBundleURLSchemes,
        ),
      ).toEqual(expect.arrayContaining(["http", "https"]));
      expect(extendInfo.NSUserActivityTypes).toContain(
        "NSUserActivityTypeBrowsingWeb",
      );
    }
  });

  it("keeps the updater provider pointed at desktop-latest release assets", async () => {
    const configText = await readFile(
      resolve(desktopPackageRoot, "electron-builder.config.json"),
      "utf8",
    );
    const config = electronBuilderConfigSchema.parse(JSON.parse(configText));

    expect(config.publish[0]).toMatchObject(DESKTOP_AUTO_UPDATE_FEED_CONFIG);
    expect(DESKTOP_AUTO_UPDATE_FEED_CONFIG.url).toBe(
      "https://github.com/laruss/patcher-browser/releases/download/desktop-latest/",
    );
  });

  it("creates a separate nightly app identity and update feed", async () => {
    const { config } = await readResolvedConfig({
      PATCHER_DESKTOP_RELEASE_CHANNEL: "nightly",
    });
    const nightlyRelease = createDesktopReleaseInfo("nightly");

    expect(config.appId).toBe("app.patcher.desktop.nightly");
    expect(config.productName).toBe("Patcher Nightly");
    expect(config.artifactName).toBe(
      "patcher-nightly-${version}-${arch}.${ext}",
    );
    expect(config.mac.icon).toBe("assets/icon-nightly.icns");
    await expect(
      access(resolve(desktopPackageRoot, config.mac.icon)),
    ).resolves.toBeUndefined();
    await expect(
      access(resolve(desktopPackageRoot, "assets/icon-nightly.png")),
    ).resolves.toBeUndefined();
    expect(config.publish[0]).toEqual({
      channel: "nightly",
      provider: "generic",
      url: nightlyRelease.updateReleaseBaseUrl,
    });
  });

  it("rejects unknown desktop release channels", async () => {
    const result = await runConfigScript({
      PATCHER_DESKTOP_RELEASE_CHANNEL: "canary",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "PATCHER_DESKTOP_RELEASE_CHANNEL must be latest or nightly",
    );
  });

  it("signs local builds via keychain auto-discovery when signing secrets are absent", async () => {
    // An unsigned bundle is provenance-tracked by macOS, which makes syspolicyd
    // evaluate every exec in the app's process tree — local builds must sign
    // with a keychain identity when one is available.
    const { config } = await readResolvedConfig({});

    expect(config.mac).not.toHaveProperty("identity");
    expect(config.mac.notarize).toBe(false);
    expect(config.dmg.sign).toBe(false);
  });

  it("keeps builds unsigned when keychain auto-discovery is explicitly disabled", async () => {
    const { config } = await readResolvedConfig({
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
    });

    expect(config.mac.identity).toBeNull();
    expect(config.mac.notarize).toBe(false);
  });

  it("rejects partial signing secret sets", async () => {
    const partialAppleCredentials = await runConfigScript({
      APPLE_ID: "sawyer@example.com",
      CSC_KEY_PASSWORD: "p12-password",
      CSC_LINK: "base64-p12",
    });

    expect(partialAppleCredentials.exitCode).toBe(1);
    expect(partialAppleCredentials.stderr).toContain(
      "Incomplete macOS signing/notarization environment.",
    );
    expect(partialAppleCredentials.stderr).toContain(
      "Present: CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID.",
    );
    expect(partialAppleCredentials.stderr).toContain(
      "Missing: APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID.",
    );
  });

  it("enables app signing and notarization when signing and Apple credentials are complete", async () => {
    const completeAppleCredentials = await readResolvedConfig({
      APPLE_APP_SPECIFIC_PASSWORD: "app-password",
      APPLE_ID: "sawyer@example.com",
      APPLE_TEAM_ID: "TEAMID1234",
      CSC_KEY_PASSWORD: "p12-password",
      CSC_LINK: "base64-p12",
      CSC_NAME: "Sawyer Hood (TEAMID1234)",
    });

    expect(completeAppleCredentials.config.mac.identity).toBe(
      "Sawyer Hood (TEAMID1234)",
    );
    expect(completeAppleCredentials.config.mac.notarize).toBe(true);
    expect(completeAppleCredentials.config.dmg.sign).toBe(false);
  });
});
