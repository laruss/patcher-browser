import { join } from "node:path";

// Turning a page-supplied download into a path on disk.
//
// Everything a download names is attacker-influenced: the filename comes from
// the response's `Content-Disposition` or from the URL, and both are written by
// the site. So the rules that turn it into a path live here, apart from the
// manager, with the filesystem injected — they are the part worth testing
// directly and the part worth reading before trusting the feature.

/**
 * A page may start this many downloads in this window before the rest are
 * refused. Same sliding-window rule the popup policy uses and the same
 * generosity: a real "download all" button fires a handful, a page farming the
 * user's disk does not stop.
 */
export const DOWNLOAD_RATE_WINDOW_MS = 10_000;
export const DOWNLOAD_RATE_MAX_IN_WINDOW = 5;

/**
 * Cap on the filename Patcher will write. Well under the 255 bytes a typical
 * filesystem allows per component, leaving room for the ` (12)` a collision
 * appends and for multi-byte characters counting as more than one byte.
 */
export const MAX_DOWNLOAD_FILENAME_LENGTH = 180;

/** How many ` (n)` variants to try before falling back to a timestamp. */
const MAX_UNIQUE_SUFFIX = 999;

const FALLBACK_DOWNLOAD_FILENAME = "download";

const CONTROL_CHARACTER_MAX = 0x1f;
const DELETE_CHARACTER = 0x7f;

/** Illegal in a filename on Windows, merely confusing everywhere else. */
const WINDOWS_ILLEGAL_CHARACTERS = /[<>:"|?*]/g;

/**
 * Reserved device names on Windows. A file called `CON` cannot be created
 * there, and the failure is obscure enough to be worth avoiding rather than
 * reporting.
 */
const WINDOWS_RESERVED_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Control characters and DEL, dropped by code point rather than by a regex
 * range: the range would have to be written as literal control bytes or as
 * escapes, and this source stays plain ASCII and says what it means.
 */
function stripControlCharacters(value: string): string {
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= CONTROL_CHARACTER_MAX || codePoint === DELETE_CHARACTER) {
      continue;
    }
    result += character;
  }
  return result;
}

interface SplitFilename {
  /** Without the extension; may be empty for a name that is only an extension. */
  stem: string;
  /** Includes the dot, or empty when there is no extension. */
  extension: string;
}

/**
 * Split at the **last** dot, which is what a browser does: a second download of
 * `archive.tar.gz` is `archive.tar (1).gz`, not `archive (1).tar.gz`. It looks
 * wrong and it is what Chrome writes, so it is what a user comparing the two
 * will expect.
 */
export function splitDownloadFilename(filename: string): SplitFilename {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) {
    return { stem: filename, extension: "" };
  }
  return { stem: filename.slice(0, dot), extension: filename.slice(dot) };
}

function truncateFilename(filename: string, maxLength: number): string {
  if (filename.length <= maxLength) {
    return filename;
  }
  const { stem, extension } = splitDownloadFilename(filename);
  // An extension long enough to fill the budget on its own is not an extension
  // any more, so the whole name is cut rather than the stem alone.
  if (extension.length >= maxLength) {
    return filename.slice(0, maxLength);
  }
  return `${stem.slice(0, maxLength - extension.length)}${extension}`;
}

/**
 * The name Patcher is willing to write, from the name the page asked for.
 *
 * What this refuses, and why each one matters:
 *
 * - **Anything but the last path component.** `../../.ssh/authorized_keys` is a
 *   filename as far as `Content-Disposition` is concerned, and joining it to a
 *   directory is how a download escapes that directory. Taking the basename is
 *   what makes the join safe, so it happens first and unconditionally.
 * - **Control characters**, including NUL — a name that ends early at the
 *   filesystem layer is a name that does not say what it will write.
 * - **`<>:"|?*`**, illegal on Windows.
 * - **Leading dots.** A page cannot drop a hidden file into the user's
 *   downloads folder. The cost is that `.gitignore` saves as `gitignore`; the
 *   benefit is that nothing arrives invisible, and `.` and `..` collapse to the
 *   fallback rather than needing their own cases.
 * - **Trailing dots and spaces**, which Windows strips silently — the file
 *   would then not have the name we reported saving it under.
 */
export function sanitizeDownloadFilename(rawFilename: string): string {
  const lastComponent = rawFilename.split(/[/\\]/).at(-1) ?? "";
  const stripped = stripControlCharacters(lastComponent)
    .replace(WINDOWS_ILLEGAL_CHARACTERS, "")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .trim();
  if (stripped.length === 0) {
    return FALLBACK_DOWNLOAD_FILENAME;
  }
  const truncated = truncateFilename(stripped, MAX_DOWNLOAD_FILENAME_LENGTH);
  const { stem } = splitDownloadFilename(truncated);
  return WINDOWS_RESERVED_STEM.test(stem) ? `_${truncated}` : truncated;
}

export interface ResolveUniqueDownloadPathArgs {
  directory: string;
  /** Injected so the naming rules are testable without touching a disk. */
  exists: (path: string) => boolean;
  /** Already through {@link sanitizeDownloadFilename}. */
  filename: string;
  /** Only used if every suffix is taken; passed in so the result is pure. */
  now: number;
}

/**
 * Where to write, avoiding whatever is already there: `report.pdf`, then
 * `report (1).pdf`, then `report (2).pdf`, as Chrome does.
 *
 * This is a check-then-write, so it is not atomic — two downloads racing for
 * the same name can both resolve to it and the second will overwrite the first.
 * The alternative (open with `O_EXCL` and keep the handle) has to own the file,
 * which Electron's `DownloadItem` does not hand over. Losing one of two
 * simultaneous downloads of the same name is the outcome this design accepts.
 */
export function resolveUniqueDownloadPath({
  directory,
  exists,
  filename,
  now,
}: ResolveUniqueDownloadPathArgs): string {
  const { stem, extension } = splitDownloadFilename(filename);
  for (let suffix = 0; suffix <= MAX_UNIQUE_SUFFIX; suffix += 1) {
    const candidate =
      suffix === 0 ? filename : `${stem} (${suffix})${extension}`;
    const path = join(directory, candidate);
    if (!exists(path)) {
      return path;
    }
  }
  // A thousand collisions means something is generating names, not a person
  // saving files. The timestamp ends the loop rather than overwriting.
  return join(directory, `${stem} (${now})${extension}`);
}
