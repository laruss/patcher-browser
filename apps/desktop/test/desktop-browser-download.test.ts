import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_DOWNLOAD_FILENAME_LENGTH,
  resolveUniqueDownloadPath,
  sanitizeDownloadFilename,
  splitDownloadFilename,
} from "../src/desktop-browser-download.js";

const DIRECTORY = "/tmp/patcher-downloads";

function pathIn(filename: string): string {
  return join(DIRECTORY, filename);
}

describe("sanitizeDownloadFilename", () => {
  // The one that matters: a filename is joined to a directory, so anything
  // that is not the last path component is how a download escapes it.
  it("keeps only the last path component", () => {
    expect(sanitizeDownloadFilename("../../.ssh/authorized_keys")).toBe(
      "authorized_keys",
    );
    expect(
      sanitizeDownloadFilename("..\\..\\Windows\\System32\\evil.dll"),
    ).toBe("evil.dll");
    expect(sanitizeDownloadFilename("/etc/passwd")).toBe("passwd");
  });

  // A name that ends early at the filesystem layer is not the name we reported.
  it("drops control characters, including NUL", () => {
    const withNul = `report${String.fromCharCode(0)}.pdf`;
    expect(sanitizeDownloadFilename(withNul)).toBe("report.pdf");
    const withEscape = `a${String.fromCharCode(27)}b${String.fromCharCode(127)}.txt`;
    expect(sanitizeDownloadFilename(withEscape)).toBe("ab.txt");
  });

  it("drops characters Windows will not accept", () => {
    expect(sanitizeDownloadFilename('re<p>o:r"t|?*.pdf')).toBe("report.pdf");
  });

  // A page must not be able to drop an invisible file into the user's folder.
  it("strips leading dots, so nothing arrives hidden", () => {
    expect(sanitizeDownloadFilename(".gitignore")).toBe("gitignore");
    expect(sanitizeDownloadFilename("...hidden.txt")).toBe("hidden.txt");
  });

  // Windows strips these silently, which would leave the file under a name
  // other than the one we said we saved.
  it("strips trailing dots and spaces", () => {
    expect(sanitizeDownloadFilename("report.pdf. . ")).toBe("report.pdf");
  });

  it("falls back for a name that sanitizes away", () => {
    expect(sanitizeDownloadFilename("")).toBe("download");
    expect(sanitizeDownloadFilename(".")).toBe("download");
    expect(sanitizeDownloadFilename("..")).toBe("download");
    expect(sanitizeDownloadFilename("   ")).toBe("download");
  });

  it("defuses Windows device names, extension or not", () => {
    expect(sanitizeDownloadFilename("CON.txt")).toBe("_CON.txt");
    expect(sanitizeDownloadFilename("nul")).toBe("_nul");
    expect(sanitizeDownloadFilename("com1.log")).toBe("_com1.log");
    // Not reserved: the rule is the whole stem, not a prefix of it.
    expect(sanitizeDownloadFilename("console.log")).toBe("console.log");
  });

  it("truncates a long name but keeps its extension", () => {
    const sanitized = sanitizeDownloadFilename(`${"a".repeat(400)}.pdf`);
    expect(sanitized.length).toBe(MAX_DOWNLOAD_FILENAME_LENGTH);
    expect(sanitized.endsWith(".pdf")).toBe(true);
  });

  // An "extension" that fills the whole budget is not one, and keeping it
  // would leave no name at all.
  it("truncates the whole name when the extension is absurd", () => {
    const sanitized = sanitizeDownloadFilename(`report.${"z".repeat(400)}`);
    expect(sanitized.length).toBe(MAX_DOWNLOAD_FILENAME_LENGTH);
    expect(sanitized.startsWith("report.")).toBe(true);
  });
});

describe("splitDownloadFilename", () => {
  it("splits at the last dot, as a browser does", () => {
    expect(splitDownloadFilename("archive.tar.gz")).toEqual({
      stem: "archive.tar",
      extension: ".gz",
    });
  });

  it("treats a name with no extension, and a dotfile, as all stem", () => {
    expect(splitDownloadFilename("README")).toEqual({
      stem: "README",
      extension: "",
    });
    // Leading dot at index 0 is not an extension boundary.
    expect(splitDownloadFilename(".gitignore")).toEqual({
      stem: ".gitignore",
      extension: "",
    });
  });
});

describe("resolveUniqueDownloadPath", () => {
  it("uses the name as asked when nothing is there", () => {
    const path = resolveUniqueDownloadPath({
      directory: DIRECTORY,
      exists: () => false,
      filename: "report.pdf",
      now: 1,
    });
    expect(path).toBe(pathIn("report.pdf"));
  });

  it("counts up past whatever is already taken", () => {
    const taken = new Set([pathIn("report.pdf"), pathIn("report (1).pdf")]);
    const path = resolveUniqueDownloadPath({
      directory: DIRECTORY,
      exists: (candidate) => taken.has(candidate),
      filename: "report.pdf",
      now: 1,
    });
    expect(path).toBe(pathIn("report (2).pdf"));
  });

  // Chrome's rule, and the one a user comparing the two will expect.
  it("puts the suffix before the last extension only", () => {
    const taken = new Set([pathIn("archive.tar.gz")]);
    const path = resolveUniqueDownloadPath({
      directory: DIRECTORY,
      exists: (candidate) => taken.has(candidate),
      filename: "archive.tar.gz",
      now: 1,
    });
    expect(path).toBe(pathIn("archive.tar (1).gz"));
  });

  it("suffixes a name with no extension", () => {
    const taken = new Set([pathIn("README")]);
    const path = resolveUniqueDownloadPath({
      directory: DIRECTORY,
      exists: (candidate) => taken.has(candidate),
      filename: "README",
      now: 1,
    });
    expect(path).toBe(pathIn("README (1)"));
  });

  // A thousand collisions is something generating names. The loop has to end
  // somewhere other than overwriting a file.
  it("falls back to a timestamp rather than overwriting", () => {
    const path = resolveUniqueDownloadPath({
      directory: DIRECTORY,
      exists: () => true,
      filename: "report.pdf",
      now: 1_700_000_000_000,
    });
    expect(path).toBe(pathIn("report (1700000000000).pdf"));
  });
});
