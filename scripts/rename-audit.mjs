#!/usr/bin/env node
// Guards the bb -> Patcher rename (docs/architecture/rename-to-patcher.md).
//
//   node scripts/rename-audit.mjs            # fail on anything unjustified
//   node scripts/rename-audit.mjs --list     # also print what the rules allowed
//
// Two scans over every tracked text file:
//
// FORWARD — any word containing `bb` in any case. Deliberately blunt. A clever
// pattern that skips `bubble` also skips `bb-something-new`, and the whole
// point of a gate is to catch the token nobody thought of. The noise that
// creates is answered by ALLOW below, where every entry carries its reason.
//
// REVERSE — `patcher` with a lowercase letter or digit welded to its left,
// which is what a careless s/bb/patcher/ leaves behind: `clobber` becomes
// `clopatcherer`, `abbrev` becomes `apatcherrev`, a hex digest grows a word in
// its middle. Only the left side is checked: `patcher` followed by lowercase is
// ordinary (`patcherdh_`, the anchor `#patcherlog`), while nothing legitimately
// runs into it from the left except `dispatcher`, and the tree has ~190 of
// those, so they are matched and dropped rather than left to drown the signal.
//
// Adding an ALLOW entry is a claim that a `bb` is correct and will stay
// correct. Write the reason for a reader who was not here.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const listMode = process.argv.includes("--list");

const SKIP_PATHS = [
  // The plan itself names every old token on purpose.
  "docs/architecture/rename-to-patcher.md",
  // This file's own rules quote the tokens they match.
  "scripts/rename-audit.mjs",
];

const BINARY_EXTENSIONS =
  /\.(png|jpg|jpeg|gif|webp|avif|ico|icns|woff2?|ttf|otf|eot|zip|gz|tgz|pdf|mp4|mov|webm|wasm|node|db|sqlite)$/iu;

// --- shared shapes ---------------------------------------------------------
// A digest, a UUID, a colour, or one of the opaque provider ids that litter
// recorded fixtures. None of these is a name anyone chose, so `bb` inside one
// is noise.
//
// Stated as the exact shapes rather than as "six or more hex characters", which
// is what this was and which let `bbdeadbeef` through — a plausible CSS class or
// fixture id, spelled entirely in hex letters. Measured before narrowing: the
// loose rule justified 134 occurrences and these three shapes justify the same
// 134, so the precision costs nothing.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
// md5, sha1, sha256. A digest of another length is not one anyone pasted.
const HEX_DIGEST = /^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64})$/iu;
// #rrggbb or #rrggbbaa, and only where the `#` is actually written: the theme
// files are full of these and `b8bb26` is a real gruvbox green.
const HEX_COLOUR = /^[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu;
const isHexColour = (word, line) =>
  HEX_COLOUR.test(word) && line.includes(`#${word}`);
// Only the prefixes that actually occur. `env`, `msg`, `proj`, `run` and `src`
// were in this list and justified nothing, so all they did was pardon their own
// plausible leftovers anywhere in the tree — `env_bb_prefix`, `src-bb-source-path`
// and `run_bb_server` all walked through a rule whose reason mentions provider
// ids. An unused alternative is a hole, not a spare.
const OPAQUE_ID =
  /^(?:toolu|call|req|turn|ws|thr|sha256|sha512)[_-][A-Za-z0-9_-]{6,}$/u;
// A long alphanumeric run that also carries a shouted uppercase run or several
// digits is a base64 or minified fragment, not an identifier someone typed.
// Length alone is not enough: `BbSomethingLongEnough` is 21 characters and
// would have walked straight through. Neither is the census: an ordinary
// camelCase name with a port or a version in it (`bbHostDaemonPort38986`)
// satisfies the digit branch, so the rule using this is bound to the paths that
// actually hold opaque bytes rather than trusted anywhere in the tree.
const isBase64ish = (word) =>
  word.length >= 16 &&
  /^[A-Za-z0-9+/=]+$/u.test(word) &&
  (/[A-Z]{4,}/u.test(word) || (word.match(/\d/gu) ?? []).length >= 2);
// Where opaque bytes legitimately live: the lockfile's integrity digests,
// recorded provider fixtures, and the story fixtures that embed a data URI.
const OPAQUE_VALUE_PATHS =
  /^bun\.lock$|__fixtures__\/|\.stories\.tsx$|\.ndjson$/u;
// aaa / bbb / BBBB / bbb2222 — the second item in a list of placeholders. Three
// repeats, not two: at two this matches a bare `bb` and quietly excuses the
// whole thing the audit exists to find.
const REPEATED_PLACEHOLDER = /^([A-Za-z])\1{2,}[0-9]*$/u;
// English words and library names that legitimately carry a double b. Two
// copies on purpose: `.test()` on a /g/ regex advances lastIndex, so the rule
// below must not share one object between its match and its strip.
const ENGLISH_DOUBLE_B_SOURCE =
  "bubble|clobber|stubbed|stubborn|grabb|abbrev|tabbab|tabbed|tabbing|rubber|globby|robbie|dabble|nibble|scribble|wobble";
const ENGLISH_DOUBLE_B = new RegExp(ENGLISH_DOUBLE_B_SOURCE, "iu");
const ENGLISH_DOUBLE_B_ALL = new RegExp(ENGLISH_DOUBLE_B_SOURCE, "giu");
// A word ending in b abutting one starting with B — `tabButton`, `WebBrowser`.
// Stripped and re-checked like the English list above, for the same reason.
// The `B` is captured so the strip can leave a separator behind: deleting the
// seam outright consumed both of the b's that made the word match, so `subBb`
// and `tabBbLeftover` were pardoned by the seam that only explains one of them.
const CAMEL_SEAM_SOURCE =
  "(?:[Tt]ab|[Ww]eb|[Ss]ub|[Ll]ab|[Cc]ab|[Nn]ub|[Rr]ib|[Tt]humb|[Cc]rumb)(B)";
const CAMEL_SEAM = new RegExp(CAMEL_SEAM_SOURCE, "u");
const CAMEL_SEAM_ALL = new RegExp(CAMEL_SEAM_SOURCE, "gu");
/** True when stripping `pattern` from `word` leaves no double b behind. */
const seamExplainsWord = (word, pattern, replacement = "") =>
  !/[Bb][Bb]/u.test(word.replace(pattern, replacement));

/**
 * Each rule may constrain the matched word, the path it sits in, and the line
 * around it. A finding is justified when one rule matches every field it
 * declares.
 */
const ALLOW = [
  // --- The values that used to be frozen -----------------------------------
  // All six were unfrozen and renamed; three of the justifications turned out
  // to be wrong (the plan's Frozen table records which). What is left is the
  // old name appearing in a comment that explains the new one, and each of
  // those is pinned by a test naming the value it now carries.
  {
    why: "a comment recording the partition rename's actual cost: userData moved with productName, so the old cookies were unreachable either way",
    word: /^bb$/u,
    line: /moved `productName` from "bb"/u,
  },
  {
    why: "comments on OpenAI's originator field, where the inherited value is the one fact that argues the new one is accepted",
    word: /^bb$/u,
    line: /inherited `bb` worked here at all|go back to the inherited `bb`/u,
  },
  {
    why: "the audit's own worked example of what it cannot see: a `bb` that became a `patcher`",
    word: /^bb$/u,
    line: /a `bb` that became a|replacing `bb` with `patcher`/u,
  },
  {
    why: "the two preloads name the global they no longer expose, which is the whole reason one name is enough",
    word: /^(?:bb|bbDesktop)$/u,
    line: /never shipped a build that reads `bbDesktop`|ever exposed page scripts under `bb`/u,
  },
  {
    why: "the assertion that an out-of-date daemon's subprotocol is now refused; the old value is the case worth stating",
    word: /^bb-host-daemon$/u,
    line: /hasHostDaemonWebSocketProtocol\("bb-host-daemon/u,
  },

  // --- Physical database names kept on purpose -----------------------------
  {
    why: "drizzle column; renaming means a migration plus regenerated snapshots for zero visible gain",
    word: /^rollback_bb_version$/u,
  },
  {
    // `bb_connect` is a `system_experiments` column, dropped back in
    // 0070_swift_rattler.sql — the name survives only in that migration.
    // `_bb_connect_machine_id_pending` is live: migrate.ts stages the
    // `connect_machine_id` rename through it, so it is read on every startup
    // that has not yet applied 0065.
    why: "a dropped drizzle column named in its own migration, and the staging column migrate.ts renames through",
    word: /^(?:bb_connect|_bb_connect_machine_id_pending)$/u,
  },
  {
    why: "the tasks plugin's own column, already mapped to linkedPatcherProjectId above store.ts",
    word: /^linked_bb_project_id$/u,
  },

  // --- Values older builds wrote, read by compatibility paths -------------
  // These are not history and not identifiers: they are the exact bytes an
  // upstream build put into a user's database or state file, matched by a
  // WHERE clause or an `===`. Renaming one does not break a build — it makes
  // the path that reads it unreachable, which is the quietest failure in this
  // whole rename.
  {
    why: "migration 0072 repairs rows upstream wrote; its own values, and the fixtures that prove it matches them",
    word: /^(?:bb-official|bb)$/u,
    path: /^packages\/db\/(?:drizzle\/0072_bizarre_the_liberteens\.sql|test\/migrate\.test\.ts)$/u,
  },
  {
    why: "the marketplace id inside a plugin registration file an older build wrote, and its fixtures",
    word: /^bb-official$/u,
    path: /^apps\/server\/(?:src\/services\/plugins\/plugin-state-snapshot\.ts|test\/services\/plugins\/plugin-state-snapshot\.test\.ts)$/u,
  },
  {
    why: "the synthetic registry marker the retired GitHub-Release marketplace wrote into source_npm_registry, and the fixture that proves the branch matches it",
    word: /^(?:bb|bb-source)$/u,
    line: /bb-source=github-release/u,
  },
  {
    why: "the comment naming the folder-era localStorage keys this build deliberately does not read",
    word: /^bb$/u,
    line: /bb\.sidebar\.folderSectionOrder|bb\.sidebar\.collapsedFolders/u,
  },
  {
    why: "the cross-thread envelope a pre-rename build wrote into thread event text, matched by the legacy-attribution recovery path and by the test that pins those bytes",
    word: /^bb$/u,
    path: /^packages\/thread-view\/(?:src\/agent-message-envelope\.ts|test\/user-message-parsing\.test\.ts)$/u,
  },

  {
    // Every one of these is the *old* name used deliberately, because the thing
    // being named is a machine or a browser that still carries it: the artifact
    // path a pre-rename daemon fetches, the global skill directories installed
    // under the old product name, and the browser-storage prefix an unmoved
    // origin still holds. Bound to the files that do that work, so the same
    // token elsewhere still fails.
    why: "the pre-rename artifact, skill and storage names, used to reach installations that still carry them",
    word: /^(?:bb|bb-app|bb-era|bb-cli|bb-plugin-authoring)$/u,
    path: /^(?:apps\/server\/src\/(?:server\.ts|internal\/session\.ts)|apps\/server\/test\/(?:app\/skeleton|public\/public-host-management)\.test\.ts|apps\/host-daemon\/src\/command-handlers\/install-global-skills(?:\.test)?\.ts|apps\/app\/src\/lib\/(?:legacy-storage-adoption(?:\.test)?|host-update-status\.test)\.ts|apps\/app\/src\/components\/sidebar\/sidebarCollapsedAtoms\.ts|packages\/host-daemon-contract\/src\/commands\.ts)$/u,
  },

  // --- History: things that happened under the old name --------------------
  {
    why: "the migration map names what this fork migrated from; patcher-migration.md would misdescribe it",
    word: /^bb-migration$/u,
  },
  {
    why: "a dated record of a manual QA pass that really ran against bb",
    path: /^qa\/manual-pass-log\.md$/u,
  },
  {
    why: "issue keys from bb's tracker, cited in comments; renumbering them into a tracker with no such issues would make them lie",
    word: /^BB-\d+$/u,
  },
  {
    why: "a task-branch slug derived from a BB- issue key",
    word: /^bb-\d+$/u,
  },
  {
    why: "a drizzle migration filename; the words are generated, the file is immutable",
    word: /^0063_broken_robbie_robertson$/u,
  },
  {
    // An applied migration's bytes are its identity: drizzle records a sha256
    // of the whole file, and `validateAppliedMigrationHistory` throws
    // "hash-mismatch" for every database that already ran it. Editing even a
    // comment stops the server booting on such a database, so the prose stays
    // exactly as it was written.
    // Bound to comment lines. Declaring only `path` pardoned every token in
    // every migration, including ones this fork has not written yet, so a future
    // schema change could add a live `bb_`-named table or column with the gate
    // green — the opposite of what the reason claims to excuse.
    why: "prose inside an already-applied drizzle migration, whose bytes are hashed in the ledger",
    path: /^packages\/db\/drizzle\/\d{4}_[a-z_]+\.sql$/u,
    line: /^\s*--/u,
  },
  {
    why: "recorded agent transcripts captured on an upstream machine, replayed verbatim as fixtures",
    word: /bb-fixture-capture/u,
  },
  {
    why: "the migration map records what this fork inherited, including names that only ever existed under bb",
    path: /^docs\/architecture\/bb-migration\.md$/u,
  },
  {
    // Both tokens on that line describe what the *pre-rename* daemon injects,
    // so both have to keep the old name or the sentence inverts and claims the
    // old daemon already spoke the new contract.
    why: "a comment naming the old env prefix and shim on purpose, so the protocol bump's reason reads",
    word: /^(?:BB_|bb)$/u,
    line: /injects `BB_\*`/u,
  },
  {
    why: "a contributor's GitHub handle",
    word: /^ryanbbrown$/u,
  },
  {
    why: "an unreferenced scaffold digest, dead before this rename and left alone rather than quietly deleted",
    path: /^apps\/server\/test\/public\/app-scaffold-template\.digest\.json$/u,
  },

  // --- The fork is stated on purpose ---------------------------------------
  {
    why: "the fork attribution and the comments explaining a frozen name or a removed link",
    word: /^(?:bb|get-bb)$/u,
    line: /fork of \[bb\]|a bb install|bb's server|belonged to bb|github\.com\/get-bb/u,
  },

  // --- English, libraries, and camelCase seams -----------------------------
  {
    // Matching the substring alone fails open: `bb-tabbed-panel` contains
    // `tabbed`, and `-` is a word character here, so a genuine leftover rides
    // in on an English neighbour. Strip every English hit and require that no
    // `bb` survives, so the rule excuses the word only when the English word
    // is the *reason* the word matched.
    why: "English words and library names that happen to contain a double b",
    word: ENGLISH_DOUBLE_B,
    test: (word) => seamExplainsWord(word, ENGLISH_DOUBLE_B_ALL),
  },
  {
    // Same fail-open, same fix: the old pattern allowed a free
    // `[A-Za-z0-9_]*` prefix, so `bbTabButton`, `__bbTabBar` and
    // `bbWebBrowser` all rode in on the seam that followed them. Strip every
    // seam and require that no `bb` survives.
    why: "a camelCase seam: a word ending in b followed by one starting with B",
    word: CAMEL_SEAM,
    test: (word) => seamExplainsWord(word, CAMEL_SEAM_ALL, "_$1"),
  },
  {
    why: "BBEdit, an editor Patcher can open a workspace in",
    word: /^bbedit/iu,
  },
  {
    // The scanner never sees the backslash, so an escape's own `b` fuses onto
    // the word after it. Declaring only `line` made this a blanket pardon for
    // every other token on that line — one Tailwind `/\\bborder-b/` assertion
    // bought immunity for a real leftover beside it. Require that the line hold
    // the escape immediately before *this* word, and that the word stop
    // matching once the escape is removed.
    why: "a regex or unicode escape whose backslash-b is followed by a b-initial word",
    test: (word, line) => {
      if (!line.includes(`\\${word}`)) return false;
      const escape = word.match(/^(?:b|u[0-9A-Fa-f]{4})/u)?.[0];
      return (
        escape !== undefined && !/[Bb][Bb]/u.test(word.slice(escape.length))
      );
    },
  },

  // --- Placeholders and opaque values --------------------------------------
  {
    why: "the second item in an aaa/bbb placeholder series",
    test: (word) => REPEATED_PLACEHOLDER.test(word),
  },
  {
    why: "a plugin id from an aaa/bbb placeholder series",
    word: /^patcher-plugin-b+$/u,
  },
  {
    why: "an authored CSS class in a build fixture, named after a hash prefix",
    word: /^bb71-authored-decoration$/u,
  },
  {
    why: "a hex digest, UUID, hex colour, or opaque provider id",
    test: (word, line) =>
      UUID.test(word) ||
      HEX_DIGEST.test(word) ||
      OPAQUE_ID.test(word) ||
      isHexColour(word, line),
  },
  {
    why: "a base64 or minified fragment in the lockfile or a recorded fixture",
    path: OPAQUE_VALUE_PATHS,
    test: (word) => isBase64ish(word),
  },
  {
    why: "a piece of an npm integrity digest; bun.lock hashes are base64 and split into words wherever a + or / falls",
    path: /^bun\.lock$/u,
    line: /"sha(?:1|256|512)-/u,
    test: (word) =>
      /^[A-Za-z0-9]{6,}$/u.test(word) &&
      /[A-Z]/u.test(word) &&
      /[a-z]/u.test(word),
  },
];

const REVERSE_ALLOW = [
  {
    // Strip-and-recheck, not an anchor. Anchoring to the whole word looked
    // stricter and was not: `dispatchApatcherREV` is letters end to end, so
    // `^[A-Za-z]*[Dd]ispatch[A-Za-z]*$` still matched it. The `patcher` this
    // rule is here to excuse is the one inside `dispatch|er`, so remove every
    // `dispatch` and require that nothing named `patcher` survives — which is
    // the same shape the forward scan's English-words rule uses.
    why: "dispatcher and its relatives; none of them is rename damage (--list counts them)",
    word: /[Dd]ispatch|DISPATCH/u,
    test: (word) =>
      !/patcher|PATCHER/u.test(word.replace(/[Dd]ispatch|DISPATCH/gu, "")),
  },
  {
    // The scan looks one character left of `patcher` and cannot tell an escape
    // from the tail of a word: a regex `\bpatcher`, and — once the line-length
    // cap came off — the `\npatcher` that a newline before "patcher" becomes
    // inside the generated template bodies. Narrowed to the escape itself, so
    // `npatcher` with no backslash in front of it anywhere else still fails.
    why: "a string or regex escape whose letter fuses onto a following `patcher`",
    test: (word, line) =>
      /^[bfnrtv]patcher/u.test(word) && line.includes(`\\${word}`),
  },
];

// ---------------------------------------------------------------------------

function trackedFiles() {
  // `--others --exclude-standard` alongside the tracked list, because a file
  // that is new is exactly the file most likely to carry a fresh leftover — and
  // running the gate before `git add` used to hide it completely. Ignored paths
  // stay out, which is the point of --exclude-standard.
  return execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      encoding: "utf8",
      maxBuffer: 1 << 28,
    },
  )
    .split("\0")
    .filter(
      (path) =>
        path.length > 0 &&
        !SKIP_PATHS.includes(path) &&
        !BINARY_EXTENSIONS.test(path),
    );
}

function justification(rules, word, path, line) {
  for (const rule of rules) {
    if (rule.word !== undefined && !rule.word.test(word)) continue;
    if (rule.path !== undefined && !rule.path.test(path)) continue;
    if (rule.line !== undefined && !rule.line.test(line)) continue;
    if (rule.test !== undefined && !rule.test(word, line)) continue;
    return rule.why;
  }
  return null;
}

const FORWARD_WORD = /[A-Za-z0-9_-]*[Bb][Bb][A-Za-z0-9_-]*/gu;
const REVERSE_WORD = /[A-Za-z0-9_-]*(?:patcher|PATCHER)[A-Za-z0-9_-]*/gu;
// A letter or digit welded to the left of `patcher`. The lookbehind was
// `[a-z0-9]`, which saw only damage from the lowercase pass — but the rename ran
// three substitutions (bb, Bb, BB), so `ApatcherREV` out of `ABBREV` was
// invisible to this scan and, having lost its `bb`, to the forward one too.
//
// The uppercase pass needs its own alternative rather than an `i` flag: `PATCHER`
// welded to a letter is always damage (`APATCHERREV` out of `ABBREV_…`, and the
// tree holds no legitimate one), while `Patcher` welded to a letter is ordinary
// PascalCase — `createPatcherSdk` and ~200 more — so matching it case-insensitively
// would drown the signal it exists to carry. Underscore is deliberately not
// welded: `__patcher*` globals and `PATCHER_*` env names are the correct shape.
const REVERSE_FUSED = /(?<=[A-Za-z0-9])(?:patcher|PATCHER)/u;

const findings = [];
const allowed = new Map();

function record(rules, direction, word, path, lineNumber, line) {
  const why = justification(rules, word, path, line);
  if (why === null) {
    findings.push({ direction, word, path, lineNumber, line: line.trim() });
    return;
  }
  const seen = allowed.get(why) ?? { count: 0, words: new Set() };
  seen.count += 1;
  if (seen.words.size < 8) seen.words.add(word);
  allowed.set(why, seen);
}

for (const path of trackedFiles()) {
  let raw;
  try {
    raw = readFileSync(path);
  } catch {
    continue;
  }
  // Binary by content, whatever the extension — but decided from a bounded
  // prefix, not the whole file. Testing every byte excluded two ordinary
  // TypeScript sources that use a literal NUL as a template-string delimiter
  // (`PluginNewThreadComposer.tsx`, `packages/db/src/data/events.ts`): they were
  // read in full and thrown away, so a residual anywhere in either passed the
  // gate. A real binary is not clean for its first 8 KB.
  if (raw.subarray(0, 8192).includes(0)) continue;
  const lines = raw.toString("utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    // Both patterns start with `[A-Za-z0-9_-]*`, so matchAll backtracks from
    // every offset in every line. The overwhelming majority of lines hold
    // neither token; skipping those first is ~10x on the whole scan and
    // cannot change the result, because a match requires one of these
    // substrings to be present.
    //
    // This filter is why there is no length cap. A `> 4000` skip sat above it
    // and silently exempted the generated template and starter-file sources,
    // whose bodies are single lines of 4 KB to 29 KB carrying the app's own
    // user-facing prose. Sixteen lines in the tree are that long and hold one
    // of these substrings, so the backtracking the cap was protecting against
    // is paid on sixteen lines rather than avoided on all of them.
    if (
      !line.includes("bb") &&
      !line.includes("bB") &&
      !line.includes("Bb") &&
      !line.includes("BB") &&
      !line.includes("patcher") &&
      !line.includes("PATCHER")
    ) {
      continue;
    }
    for (const match of line.matchAll(FORWARD_WORD)) {
      record(ALLOW, "bb", match[0], path, index + 1, line);
    }
    for (const match of line.matchAll(REVERSE_WORD)) {
      if (!REVERSE_FUSED.test(match[0])) continue;
      record(REVERSE_ALLOW, "patcher", match[0], path, index + 1, line);
    }
  }
}

if (listMode) {
  console.log("Justified:");
  const byCount = [...allowed].sort((a, b) => b[1].count - a[1].count);
  for (const [why, seen] of byCount) {
    console.log(`  ${String(seen.count).padStart(4)}  ${why}`);
    console.log(`        e.g. ${[...seen.words].join(", ")}`);
  }
  console.log("");
}

if (findings.length === 0) {
  const total = [...allowed.values()].reduce(
    (sum, seen) => sum + seen.count,
    0,
  );
  console.log(`rename audit: clean (${total} occurrences justified by rule)`);
  process.exit(0);
}

console.error(
  `rename audit: ${findings.length} occurrence${findings.length === 1 ? "" : "s"} with no justification.\n`,
);
for (const finding of findings.slice(0, 60)) {
  console.error(
    `  ${finding.path}:${finding.lineNumber}  ${finding.direction === "bb" ? "residual" : "damaged"} "${finding.word}"`,
  );
  console.error(`      ${finding.line.slice(0, 120)}`);
}
if (findings.length > 60) {
  console.error(`  ... and ${findings.length - 60} more`);
}
console.error(
  "\nEither rename it, or add a rule to ALLOW in scripts/rename-audit.mjs with the reason it stays.",
);
process.exit(1);
