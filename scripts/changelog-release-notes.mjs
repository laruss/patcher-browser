// Prints the CHANGELOG entry for one version, so a release page says what is in
// the build instead of only how to install it. `build-desktop.yml` calls it
// twice when it publishes an alpha: once before the build, where a missing entry
// is what stops the release, and again at the publish step, where the entry
// becomes the first section of the release notes.
//
// Exiting non-zero for a version with no entry is therefore the point rather
// than an inconvenience. It used to be caught and turned into a `::warning::`,
// which published an alpha whose page carried the install instructions alone.
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultChangelogPath = resolve(dirname(scriptPath), "..", "CHANGELOG.md");

/**
 * The body under `## <version>`, up to the next `## ` heading, or null when the
 * changelog has no entry for that version. Headings are compared as whole
 * lines, so a version string is never treated as a pattern.
 */
export function extractChangelogEntry({ changelog, version }) {
  const lines = changelog.split("\n");
  const headingIndex = lines.indexOf(`## ${version}`);

  if (headingIndex === -1) {
    return null;
  }

  const bodyLines = [];

  for (const line of lines.slice(headingIndex + 1)) {
    if (line.startsWith("## ")) {
      break;
    }

    bodyLines.push(line);
  }

  const body = bodyLines.join("\n").trim();

  return body.length === 0 ? null : body;
}

async function main() {
  const [version, changelogPath = defaultChangelogPath] = process.argv.slice(2);

  if (version === undefined || version.length === 0) {
    throw new Error(
      "Usage: node scripts/changelog-release-notes.mjs <version> [changelog-path]",
    );
  }

  const changelog = await readFile(changelogPath, "utf8");
  const body = extractChangelogEntry({ changelog, version });

  if (body === null) {
    throw new Error(`No CHANGELOG entry for ${version} in ${changelogPath}`);
  }

  process.stdout.write(`${body}\n`);
}

// `import.meta.url` is the symlink-resolved path, so a checkout reached through
// a symlink — /tmp on macOS, most of all — makes a plain comparison with
// argv[1] disagree, and the script would then exit 0 having printed nothing.
function realPathOrEmpty(candidatePath) {
  try {
    return realpathSync(resolve(candidatePath));
  } catch {
    return "";
  }
}

if (realPathOrEmpty(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);

    console.error(message);
    process.exitCode = 1;
  });
}
