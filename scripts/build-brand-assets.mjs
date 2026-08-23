// Renders every raster the Patcher mark appears in from assets/patcher-icon.svg
// and assets/patcher-logo.svg, so the artwork can be revised in one place.
//
// Not wired into CI and deliberately without a --check gate: these outputs are
// committed binaries that change only when the mark does. Run it by hand after
// editing either source SVG:
//
//   node scripts/build-brand-assets.mjs
//   bun run --filter @patcher/app generate:pwa-icons   # tinted variants after
//
// The second command is not optional. apps/app/public holds five hand-authored
// bases and forty generated tints derived from them, behind a --check gate that
// fails the app's tests when they drift.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createDesktopReleaseConfig } from "../apps/desktop/scripts/desktop-release-channel.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// sharp belongs to @patcher/app, which is where the other icon generator lives.
// Resolving it from there rather than adding a root dependency keeps this
// script out of the lockfile — see bb-migration.md invariant 4 on why a
// dependency change is never incidental here.
const sharp = createRequire(join(repoRoot, "apps", "app", "package.json"))(
  "sharp",
);
const assetsDir = join(repoRoot, "assets");
const desktopAssetsDir = join(repoRoot, "apps", "desktop", "assets");
const appPublicDir = join(repoRoot, "apps", "app", "public");

// The two source SVGs, read rather than restated. The header above promises the
// artwork can be revised in one place, and it was not true while the path data
// lived here as well: editing either file changed no raster, and the glyph box
// this script used had already drifted from the logo's own viewBox.
//
// Every derivation below is a substitution on a shape asserted to be present,
// so an SVG rewritten into a shape this script cannot read fails loudly instead
// of rendering something almost right.
const iconSource = await readFile(join(assetsDir, "patcher-icon.svg"), "utf8");
const logoSource = await readFile(join(assetsDir, "patcher-logo.svg"), "utf8");

/**
 * `String.replace` reads `$&`, `$1` and `$'` in its replacement, and the
 * substitutions below deliberately use `$1`. A value interpolated *into* one of
 * them must not: `logoViewBox()` comes out of an SVG file, so a `$` in it would
 * silently produce a different attribute instead of the one it names.
 */
const asReplacementLiteral = (value) => String(value).replaceAll("$", "$$$$");

function substitute(svg, pattern, replacement, what) {
  const matches = svg.match(new RegExp(pattern, "gu"))?.length ?? 0;
  if (matches !== 1) {
    throw new Error(
      `build-brand-assets: expected exactly one ${what} in the source SVG, found ${matches}. ` +
        `The artwork changed shape — update the substitution, not the raster.`,
    );
  }
  return svg.replace(new RegExp(pattern, "u"), replacement);
}

/** The plate mark from patcher-icon.svg: rounded square, ink P, red patch. */
function iconSvg({ plate, radius } = {}) {
  let svg = iconSource;
  if (plate !== undefined) {
    svg = substitute(
      svg,
      '(<rect width="64" height="64"[^>]*fill=)"[^"]*"',
      `$1"${asReplacementLiteral(plate)}"`,
      "plate fill",
    );
  }
  if (radius !== undefined) {
    svg = substitute(
      svg,
      '(<rect width="64" height="64"[^>]*)rx="[^"]*"',
      `$1rx="${asReplacementLiteral(radius)}"`,
      "plate corner radius",
    );
  }
  return svg;
}

/**
 * The glyph alone from patcher-logo.svg, which is already cropped to the mark
 * and single-fill by design (it is rendered through `dark:invert`), so one
 * colour is the whole API.
 */
function glyphSvg(fill) {
  return logoSource.replaceAll(/fill="#[0-9A-Fa-f]{3,8}"/gu, `fill="${fill}"`);
}

/**
 * The full-colour glyph — ink P, red patch — cropped the way the logo is. Taken
 * from the icon SVG with its plate removed rather than by recolouring the logo,
 * so the red comes from the file that defines it.
 */
function colourGlyphSvg() {
  const cropped = substitute(
    iconSource,
    'viewBox="0 0 64 64"',
    `viewBox="${asReplacementLiteral(logoViewBox())}"`,
    "icon viewBox",
  );
  return substitute(
    cropped,
    '\\s*<rect width="64" height="64"[^>]*/>',
    "",
    "plate rect",
  );
}

function logoViewBox() {
  const viewBox = /viewBox="([^"]*)"/u.exec(logoSource)?.[1];
  if (viewBox === undefined) {
    throw new Error("build-brand-assets: patcher-logo.svg has no viewBox.");
  }
  return viewBox;
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

function render(svg, size) {
  // density high enough that the rasterizer works well above the target size;
  // sharp resamples down, so curves stay clean at 16px.
  return sharp(Buffer.from(svg), { density: 2400 })
    .resize(size, size, { fit: "contain", background: TRANSPARENT })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** The full-colour mark inset on a flat plate that fills the canvas. */
async function insetMark({ size, plate, coverage, opaque }) {
  const markSize = Math.round(size * coverage);
  const mark = await render(colourGlyphSvg(), markSize);
  const offset = Math.round((size - markSize) / 2);
  const buffer = await sharp({
    create: { width: size, height: size, channels: 4, background: plate },
  })
    .composite([{ input: mark, left: offset, top: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  return opaque
    ? sharp(buffer).flatten({ background: "#ffffff" }).png().toBuffer()
    : buffer;
}

/**
 * The plate mark at full canvas scale — used where the artwork is the whole
 * tile, as opposed to insetMark above, which shrinks it into a safe zone.
 */
async function plateIcon({ size, plate, radius, opaque }) {
  const buffer = await sharp(Buffer.from(iconSvg({ plate, radius })), {
    density: 2400,
  })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  return opaque
    ? sharp(buffer).flatten({ background: "#ffffff" }).png().toBuffer()
    : buffer;
}

/**
 * macOS app icon: a 1024 canvas whose art occupies the inner 824, which is the
 * grid every other Dock icon is drawn on. Without the margin the icon renders
 * visibly larger than its neighbours.
 */
async function macIcon(plate) {
  const canvas = 1024;
  const art = 824;
  const inset = Math.round((canvas - art) / 2);
  const plateBuffer = await sharp(Buffer.from(iconSvg({ plate })), {
    density: 2400,
  })
    .resize(art, art)
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 4,
      background: TRANSPARENT,
    },
  })
    .composite([{ input: plateBuffer, left: inset, top: inset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** iconutil wants a full .iconset directory, not a single PNG. */
async function writeIcns(sourcePng, outputPath) {
  const workDir = await mkdtemp(join(tmpdir(), "patcher-icns-"));
  try {
    await writeIconset(workDir, sourcePng, outputPath);
  } finally {
    // `iconutil` is macOS-only, so this rejects on any other machine. Without
    // the finally the iconset survives in $TMPDIR on every failed run.
    await rm(workDir, { recursive: true, force: true });
  }
}

async function writeIconset(workDir, sourcePng, outputPath) {
  const iconsetDir = join(workDir, "icon.iconset");
  await mkdir(iconsetDir);
  const entries = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];
  for (const [size, name] of entries) {
    await writeFile(
      join(iconsetDir, name),
      await sharp(sourcePng).resize(size, size).png().toBuffer(),
    );
  }
  await execFileAsync("iconutil", [
    "--convert",
    "icns",
    "--output",
    outputPath,
    iconsetDir,
  ]);
}

const written = [];
async function emit(path, buffer) {
  await writeFile(path, buffer);
  written.push(path.slice(repoRoot.length + 1));
}

// --- Repository brand assets ------------------------------------------------
// The plate icon as a raster: both READMEs embed it, and GitHub and npm are
// unreliable about rendering an SVG through an <img>, so PNG is the safe one.
// The source SVG unmodified — its plate colour and corner radius are the
// canonical ones, so overriding them here would be the duplication again.
await emit(
  join(assetsDir, "patcher-icon.png"),
  await plateIcon({ size: 1024, opaque: false }),
);

// --- Desktop app icons ------------------------------------------------------
// One mark, three plates. The plate colour is the only channel signal, so a
// nightly and a stable build are told apart in the Dock at a glance.
//
// The two release channels' filenames come from the release config that
// electron-builder reads, rather than being restated here: a channel that
// renames its icon would otherwise ship without one. `icon-dev.png` is not a
// release channel — apps/desktop/src/app-paths.ts picks it for an unpackaged
// run — so it is named here, where nothing else owns it.
const releaseChannels = ["latest", "nightly"].map((channel) => {
  const config = createDesktopReleaseConfig(channel);
  return {
    png: config.iconFileName,
    icns: config.macIconPath.replace(/^assets\//u, ""),
  };
});
const desktopChannels = [
  { plate: undefined, ...releaseChannels[0] },
  { plate: "#378055", png: "icon-dev.png", icns: null },
  { plate: "#F9D71C", ...releaseChannels[1] },
];
for (const channel of desktopChannels) {
  const buffer = await macIcon(channel.plate);
  const pngPath = join(desktopAssetsDir, channel.png);
  await emit(pngPath, buffer);
  if (channel.icns !== null) {
    await writeIcns(buffer, join(desktopAssetsDir, channel.icns));
    written.push(join("apps", "desktop", "assets", channel.icns));
  }
}

// --- PWA base icons ---------------------------------------------------------
// Square, full bleed: the platform supplies the corner mask. The five base
// filenames are also listed in apps/app/scripts/generate-pwa-icons.mjs, which
// owns them; it runs on import so the list cannot be shared, but its --check
// gate fails the app's tests if a base stops being written here.
// generate-pwa-icons derives forty tinted variants from these five, and its
// luma mask treats
// anything at or above 245 as backing — which is why the plate here is a lighter
// cream than the desktop plate. At 512px the difference is invisible; at the
// mask it is the difference between tinting the glyph and tinting the tile.
const PWA_PLATE = "#FAF8F4";
for (const size of [192, 512]) {
  await emit(
    join(appPublicDir, `icon-${size}.png`),
    await plateIcon({ size, plate: PWA_PLATE, radius: 0, opaque: false }),
  );
  // Maskable icons are cropped to a circle of 80% diameter on some launchers,
  // so the mark has to sit inside that safe zone rather than fill the tile.
  await emit(
    join(appPublicDir, `icon-${size}-maskable.png`),
    await insetMark({
      size,
      plate: PWA_PLATE,
      coverage: 0.5,
      opaque: false,
    }),
  );
}
// iOS paints transparency in a touch icon black, so this one is flattened.
await emit(
  join(appPublicDir, "apple-touch-icon.png"),
  await plateIcon({ size: 180, plate: PWA_PLATE, radius: 0, opaque: true }),
);

// --- Favicons ---------------------------------------------------------------
// Transparent glyph, three inks: the browser tab supplies the background, and
// index.html swaps the file on prefers-color-scheme and in dev.
const faviconInks = [
  { suffix: "", fill: "#1E1E1E" },
  { suffix: "-dark", fill: "#FFFFF4" },
  { suffix: "-dev", fill: "#A1A0A0" },
];
for (const { suffix, fill } of faviconInks) {
  for (const size of [16, 32]) {
    await emit(
      join(appPublicDir, `favicon-${size}x${size}${suffix}.png`),
      await render(glyphSvg(fill), size),
    );
  }
}

console.log(`brand assets: wrote ${written.length} files`);
for (const path of written) console.log(`  ${path}`);
