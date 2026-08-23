import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type {
  PatcherPluginApi,
  PluginBrowserConsoleEntry,
  PluginBrowserCookie,
  PluginBrowserNetworkEntry,
  PluginBrowserAction,
  PluginBrowserKeyModifier,
  PluginBrowserPageState,
  PluginBrowserRouteState,
  PluginBrowserRoutes,
  PluginBrowserStorageArea,
  PluginBrowserStorageItem,
  PluginBrowserTab,
  PluginBrowserTrace,
  PluginBrowserVideo,
  PluginCliResult,
} from "@patcher/plugin-sdk";
import { DEFAULT_PAGE_TEXT_MAX_LENGTH, explainBrowserError } from "./tools.js";
import {
  NO_FFMPEG_MESSAGE,
  encodeBrowserVideo,
  ffmpegEncodeArgs,
  installFfmpegWithBrew,
  resolveBrew,
  resolveFfmpeg,
} from "./ffmpeg.js";

/**
 * `patcher browser …` — the same `patcher.browser` API the agent tools use, from a
 * terminal.
 *
 * It exists because the agent path is only observable by running an agent: the
 * tools are served to a provider session inside a thread, so a broken bridge
 * shows up as a model saying something odd, minutes later. This drives the whole
 * chain — server → hub → WebSocket → app → executor → Electron — in one command,
 * which makes it the fast way to tell a broken bridge from a broken tool.
 *
 * Plugin CLI commands run in the server process, exactly where the agent tools'
 * handlers run, so what this exercises is genuinely the same path.
 */

interface ParsedArgs {
  positionals: string[];
  json: boolean;
  newTab: boolean;
  tabId: string | undefined;
  max: number | undefined;
  generation: number | undefined;
  button: "left" | "middle" | "right";
  double: boolean;
  modifiers: PluginBrowserKeyModifier[];
  status: number | undefined;
  body: string | undefined;
  contentType: string | undefined;
  headers: { name: string; value: string }[];
  selector: string | undefined;
  screenshots: boolean;
  fullPage: boolean;
  encode: boolean;
  fps: number | undefined;
}

const MODIFIERS = new Set(["Alt", "Control", "Meta", "Shift"]);

function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  const positionals: string[] = [];
  let json = false;
  let newTab = false;
  let tabId: string | undefined;
  let max: number | undefined;
  let generation: number | undefined;
  let button: "left" | "middle" | "right" = "left";
  let double = false;
  const modifiers: PluginBrowserKeyModifier[] = [];
  let status: number | undefined;
  let body: string | undefined;
  let contentType: string | undefined;
  const headers: { name: string; value: string }[] = [];
  let selector: string | undefined;
  let screenshots = false;
  let fullPage = false;
  let encode = false;
  let fps: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--json") {
      json = true;
    } else if (arg === "--new-tab") {
      newTab = true;
    } else if (arg === "--double") {
      double = true;
    } else if (arg === "--screenshots") {
      screenshots = true;
    } else if (arg === "--full-page") {
      fullPage = true;
    } else if (arg === "--encode") {
      encode = true;
    } else if (arg === "--fps") {
      index += 1;
      const raw = argv[index];
      const value = Number(raw);
      if (
        raw === undefined ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 30
      ) {
        return { error: "--fps needs 1 to 30" };
      }
      fps = value;
    } else if (arg === "--tab") {
      index += 1;
      tabId = argv[index];
      if (tabId === undefined || tabId.length === 0) {
        return { error: "--tab needs a tab id" };
      }
    } else if (arg === "--button") {
      index += 1;
      const raw = argv[index];
      if (raw !== "left" && raw !== "middle" && raw !== "right") {
        return { error: "--button needs left, middle or right" };
      }
      button = raw;
    } else if (arg === "--status") {
      index += 1;
      const raw = argv[index];
      const value = Number(raw);
      if (
        raw === undefined ||
        !Number.isInteger(value) ||
        value < 100 ||
        value > 599
      ) {
        return { error: "--status needs an HTTP status code" };
      }
      status = value;
    } else if (arg === "--selector") {
      index += 1;
      selector = argv[index];
      if (selector === undefined || selector.length === 0) {
        return { error: "--selector needs a CSS selector" };
      }
    } else if (arg === "--body" || arg === "--content-type") {
      index += 1;
      const raw = argv[index];
      if (raw === undefined) {
        return { error: `${arg} needs a value` };
      }
      if (arg === "--body") {
        body = raw;
      } else {
        contentType = raw;
      }
    } else if (arg === "--header") {
      index += 1;
      const raw = argv[index] ?? "";
      const separator = raw.indexOf(":");
      if (separator <= 0) {
        return { error: '--header needs "Name: value"' };
      }
      headers.push({
        name: raw.slice(0, separator).trim(),
        value: raw.slice(separator + 1).trim(),
      });
    } else if (arg === "--modifier") {
      index += 1;
      const raw = argv[index];
      if (raw === undefined || !MODIFIERS.has(raw)) {
        return { error: "--modifier needs Alt, Control, Meta or Shift" };
      }
      modifiers.push(raw as PluginBrowserKeyModifier);
    } else if (arg === "--max" || arg === "--generation") {
      index += 1;
      const raw = argv[index];
      const value = Number(raw);
      const floor = arg === "--max" ? 1 : 0;
      if (raw === undefined || !Number.isInteger(value) || value < floor) {
        return {
          error:
            arg === "--max"
              ? "--max needs a positive integer"
              : "--generation needs a non-negative integer",
        };
      }
      if (arg === "--max") {
        max = value;
      } else {
        generation = value;
      }
    } else if (arg.startsWith("--")) {
      return { error: `unknown option ${arg}` };
    } else {
      positionals.push(arg);
    }
  }

  return {
    positionals,
    json,
    newTab,
    tabId,
    max,
    generation,
    button,
    double,
    modifiers,
    status,
    body,
    contentType,
    headers,
    selector,
    screenshots,
    fullPage,
    encode,
    fps,
  };
}

function tabLine(tab: PluginBrowserTab): string {
  const marks = [
    tab.active ? "*" : " ",
    tab.live ? "live" : "cold",
    tab.loading ? "loading" : "",
  ]
    .filter((mark) => mark.length > 0)
    .join(" ");
  return `${marks}\t${tab.tabId}\t${tab.url === "" ? "(new tab)" : tab.url}\t${tab.title ?? ""}`;
}

function renderTabs(tabs: readonly PluginBrowserTab[], json: boolean): string {
  if (json) {
    return `${JSON.stringify(tabs, null, 2)}\n`;
  }
  if (tabs.length === 0) {
    return "No open tabs.\n";
  }
  // "cold" is the one worth seeing at a glance: a tab with no live view cannot
  // be read or navigated back/forward.
  return `${tabs.map(tabLine).join("\n")}\n`;
}

function renderTab(tab: PluginBrowserTab, json: boolean): string {
  return json ? `${JSON.stringify(tab, null, 2)}\n` : `${tabLine(tab)}\n`;
}

function renderPageState(state: PluginBrowserPageState, json: boolean): string {
  if (json) {
    return `${JSON.stringify(state, null, 2)}\n`;
  }
  return `${state.url}\t${state.title ?? ""}\n`;
}

function consoleLine(entry: PluginBrowserConsoleEntry): string {
  const where = entry.source === "" ? "" : `\t${entry.source}:${entry.line}`;
  return `${entry.level}\t${entry.text}${where}`;
}

function networkLine(entry: PluginBrowserNetworkEntry): string {
  // The status column carries the error when there is no status, because
  // "which requests went wrong" is the question this listing exists for.
  const outcome =
    entry.error ?? (entry.status === null ? "-" : String(entry.status));
  return `${outcome}\t${entry.method}\t${entry.resourceType}${
    entry.fromCache ? " (cache)" : ""
  }\t${entry.url}`;
}

/**
 * A log slice, plus what it is not showing. The dropped count goes to stderr so
 * stdout stays a clean list of lines to grep, while a human still learns that
 * the buffer had more.
 */
function renderLog<TEntry>(
  log: { entries: TEntry[]; droppedCount: number },
  line: (entry: TEntry) => string,
  json: boolean,
  empty: string,
): PluginCliResult {
  if (json) {
    return { exitCode: 0, stdout: `${JSON.stringify(log, null, 2)}\n` };
  }
  return {
    exitCode: 0,
    stdout:
      log.entries.length === 0
        ? `${empty}\n`
        : `${log.entries.map(line).join("\n")}\n`,
    stderr:
      log.droppedCount > 0
        ? `${log.droppedCount} earlier entr${log.droppedCount === 1 ? "y" : "ies"} not shown\n`
        : undefined,
  };
}

function cookieLine(cookie: PluginBrowserCookie): string {
  const flags = [
    cookie.secure ? "secure" : "",
    cookie.httpOnly ? "httpOnly" : "",
    `SameSite=${cookie.sameSite}`,
  ]
    .filter((flag) => flag.length > 0)
    .join(" ");
  const expiry =
    cookie.expires < 0
      ? "session"
      : new Date(cookie.expires * 1000).toISOString();
  return `${cookie.name}\t${cookie.value}\t${cookie.domain}${cookie.path}\t${expiry}\t${flags}`;
}

function itemLine(item: PluginBrowserStorageItem): string {
  return `${item.name}\t${item.value}`;
}

/**
 * A list, or JSON when asked. Kept apart from `renderLog` because storage has no
 * dropped count: what it does have is a truncation flag, which is reported by
 * the callers that can produce one.
 */
function renderList<TEntry>(
  entries: readonly TEntry[],
  line: (entry: TEntry) => string,
  json: boolean,
  empty: string,
): PluginCliResult {
  if (json) {
    return { exitCode: 0, stdout: `${JSON.stringify(entries, null, 2)}\n` };
  }
  return {
    exitCode: 0,
    stdout:
      entries.length === 0 ? `${empty}\n` : `${entries.map(line).join("\n")}\n`,
  };
}

function routeLine(route: PluginBrowserRouteState): string {
  // The hit count is first because it is the question: a mock that never fired
  // is the usual reason a page still shows the real data.
  return `${route.matched}\t${route.status}\t${route.contentType}\t${route.pattern}`;
}

/**
 * The routes a tab holds. Offline goes to stderr rather than into the list: it
 * is not a route, but a caller looking at an empty list wants to know.
 */
function renderRoutes(
  result: PluginBrowserRoutes,
  json: boolean,
): PluginCliResult {
  const listed = renderList(
    result.routes,
    routeLine,
    json,
    "That tab mocks nothing.",
  );
  return {
    ...listed,
    stderr: result.offline ? "This tab is offline.\n" : undefined,
  };
}

function numbered(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * A trace as a directory: the log, and one JPEG per step that had one. The
 * images leave the JSON and become file names, because a trace with a megabyte
 * of base64 inside it is not a file anyone opens twice.
 */
async function writeTrace(
  directory: string,
  trace: PluginBrowserTrace,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  let images = 0;
  const steps = [];
  for (const step of trace.steps) {
    let image: string | null = null;
    if (step.image !== null) {
      images += 1;
      image = `step-${numbered(step.seq, 3)}.jpg`;
      await writeFile(
        join(directory, image),
        Buffer.from(step.image, "base64"),
      );
    }
    steps.push({ ...step, image });
  }
  await writeFile(
    join(directory, "trace.json"),
    `${JSON.stringify(
      {
        durationMs: trace.durationMs,
        droppedSteps: trace.droppedSteps,
        droppedImages: trace.droppedImages,
        steps,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return `${directory}\t${trace.steps.length} steps, ${images} images, ${seconds(
    trace.durationMs,
  )}\n`;
}

/**
 * A film as a directory: the frames, a manifest, and an ffconcat playlist that
 * carries the timings.
 *
 * The playlist is the useful half. Frames arrive when the page repaints, so they
 * are not evenly spaced, and feeding them to an encoder as a numbered sequence
 * would play back at the wrong speed — `frames.txt` is what makes one `ffmpeg`
 * command produce a video that runs at the speed the session did.
 */
async function writeVideo(
  directory: string,
  video: PluginBrowserVideo,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const playlist = ["ffconcat version 1.0"];
  const frames: { at: number; file: string }[] = [];
  for (const [index, frame] of video.frames.entries()) {
    const file = `frame-${numbered(index + 1, 5)}.jpg`;
    await writeFile(join(directory, file), Buffer.from(frame.base64, "base64"));
    const until = video.frames[index + 1]?.at ?? video.durationMs;
    playlist.push(
      `file ${file}`,
      `duration ${Math.max(0.001, (until - frame.at) / 1000).toFixed(3)}`,
    );
    frames.push({ at: frame.at, file });
  }
  // The concat demuxer ignores the last entry's duration unless the file is
  // named once more, which is how the final frame gets to be on screen at all.
  const last = frames[frames.length - 1];
  if (last !== undefined) {
    playlist.push(`file ${last.file}`);
  }
  await writeFile(
    join(directory, "frames.txt"),
    `${playlist.join("\n")}\n`,
    "utf8",
  );
  await writeFile(
    join(directory, "video.json"),
    `${JSON.stringify(
      {
        durationMs: video.durationMs,
        droppedFrames: video.droppedFrames,
        chapters: video.chapters,
        frames,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return `${directory}\t${frames.length} frames, ${seconds(video.durationMs)}\n`;
}

/** The origin a saved state is keyed by, or null when the URL is not one. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Playwright's `storageState` file, which is the format we read and write so a
 * session saved here loads there and back.
 *
 * `sessionStorage` is deliberately absent: it is not part of that format, and
 * inventing a field would break the interop this exists for.
 */
interface BrowserStorageStateFile {
  cookies: PluginBrowserCookie[];
  origins: Array<{
    origin: string;
    localStorage: PluginBrowserStorageItem[];
  }>;
}

function parseStorageStateFile(raw: string): BrowserStorageStateFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as { cookies?: unknown; origins?: unknown };
  const cookies = record.cookies ?? [];
  const origins = record.origins ?? [];
  if (!Array.isArray(cookies) || !Array.isArray(origins)) {
    return null;
  }
  // Only the shape is checked here. Each cookie is validated where every other
  // browser argument is — in the host's API — so one file's bad cookie reports
  // itself the same way a plugin's bad cookie would.
  return {
    cookies: cookies as PluginBrowserCookie[],
    origins: origins.filter(
      (entry): entry is BrowserStorageStateFile["origins"][number] =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { origin?: unknown }).origin === "string",
    ),
  };
}

const USAGE = `Usage: patcher browser <command> [options]

Reading
  status                     Whether an app window can serve browser commands
  snapshot [--max <depth>] [--selector <css>]
                             Accessibility tree with [ref=eN] on interactive elements;
                             --selector snapshots one region of a large page
  tabs                       List open tabs
  url | title                Read a tab's address or title
  text [--max <n>]           Read the page's visible text
  selection                  Read the page's selected text
  screenshot <file> [--full-page]
                             Write a PNG/JPEG of the viewport, or of the whole page
  pdf <file>                 Print the whole page to a PDF
  console [--max <n>]        What the page logged, since the tab opened
  network [--max <n>]        What the tab requested, since it opened

Acting (refs come from snapshot)
  click <ref> [--button b] [--double] [--modifier M]
  hover <ref>
  drag <ref> <target-ref>
  fill <ref> <text>          Replace a field's value
  type <ref> <text>          Send one keystroke per character
  press <key> [<ref>]        e.g. Enter, Escape, Control+a
  select <ref> <value>...    Choose options in a dropdown
  check <ref> | uncheck <ref>
  upload <ref> <path>...     Hand a file input local files
  resize <width> <height>    Emulated viewport; "resize reset" restores it

Storage — cookies and web storage are the user's live logins, not settings
  cookie-list                Cookies the tab's URL carries, values included
  cookie-get <name>          One of them
  cookie-set <name> <value>  Set one on the tab's URL
  cookie-delete <name>       Remove one
  cookie-clear               Remove all of them
  localstorage-list | localstorage-get <key>
  localstorage-set <key> <value> | localstorage-delete <key> | localstorage-clear
  sessionstorage-...         The same five, for sessionStorage
  state-save [file]          Cookies + localStorage in Playwright's format
  state-load <file>          Write a saved state back into this tab

Direct control — these skip what makes the commands above safe
  eval <function> [ref]      Run JS in the page: 'eval "() => document.title"'
  mousemove <x> <y>          Move the pointer to viewport pixels
  mousedown | mouseup [b]    Press/release at the last mousemove point
  mousewheel <dx> <dy>       Scroll there
  route <pattern> [--status n] [--body text] [--content-type t] [--header "N: v"]
                             Answer matching requests yourself; ** crosses /, * does not
  route-list                 What this tab mocks, and how often each fired
  unroute [pattern]          Remove one route, or all of them
  network-state-set <offline|online>

Recording — what was done, and what it looked like
  tracing-start [--screenshots]
                             Log every command Patcher runs from here on
  tracing-stop [dir]         End it; with a dir, write trace.json and its images
  video-start [--fps n]      Film the tab (default 5/s; it must stay visible)
  video-chapter <title>      Mark a moment in the film
  video-stop <dir> [--encode]
                             End it; write the frames, a manifest and frames.txt.
                             --encode also runs the system ffmpeg over them
  install-ffmpeg             Install the encoder with Homebrew, if it is missing

Navigating
  open <url> [--new-tab]     Open a URL (http/https)
  close <tab-id>             Close a tab
  activate <tab-id>          Bring a tab to the front
  back | forward | reload    Drive a tab's history
  dialog <accept|dismiss>    Answer a JavaScript dialog blocking a page

Options:
  --tab <tab-id>       Act on this tab instead of the active one
  --generation <n>     Refuse refs unless they came from this snapshot
  --max <n>            Characters of page text, tree depth, or log entries
  --selector <css>     Snapshot only what this CSS selector matches
  --encode             Encode a stopped film to video.mp4 (needs ffmpeg)
  --button <b>         left (default), middle, right
  --double             Double click
  --modifier <M>       Alt, Control, Meta or Shift; repeatable
  --status <n>         Status code a route answers with (default 200)
  --body <text>        Body a route answers with
  --content-type <t>   Its content type (guessed from the body otherwise)
  --header "N: v"      An extra response header; repeatable
  --screenshots        Capture the tab after each traced step
  --full-page          Screenshot the whole document, not the visible viewport
  --fps <n>            Frames a second to keep while filming (1-30)
  --json               Machine-readable output
`;

export function registerBrowserToolsCli(patcher: PatcherPluginApi): void {
  patcher.cli.register({
    name: "browser",
    summary: "Drive the Patcher desktop app's browser surface",
    commands: [
      {
        name: "status",
        summary: "Show whether a browser window is connected",
        usage: "patcher browser status [--json]",
      },
      {
        name: "snapshot",
        summary:
          "Accessibility tree of a page, with refs on interactive elements",
        usage:
          "patcher browser snapshot [--tab <tab-id>] [--max <depth>] [--selector <css>] [--json]",
      },
      {
        name: "click",
        summary: "Click an element named by a snapshot ref",
        usage:
          "patcher browser click <ref> [--button left|middle|right] [--double] [--modifier <M>] [--tab <tab-id>] [--generation <n>]",
      },
      {
        name: "hover",
        summary: "Move the pointer over an element",
        usage:
          "patcher browser hover <ref> [--tab <tab-id>] [--generation <n>]",
      },
      {
        name: "drag",
        summary: "Drag one element onto another",
        usage: "patcher browser drag <ref> <target-ref> [--tab <tab-id>]",
      },
      {
        name: "fill",
        summary: "Replace the value of a text field",
        usage: "patcher browser fill <ref> <text> [--tab <tab-id>]",
      },
      {
        name: "type",
        summary: "Type into a field one keystroke at a time",
        usage: "patcher browser type <ref> <text> [--tab <tab-id>]",
      },
      {
        name: "press",
        summary: "Press a key, optionally on a specific element",
        usage: "patcher browser press <key> [<ref>] [--tab <tab-id>]",
      },
      {
        name: "select",
        summary: "Choose one or more options in a dropdown",
        usage: "patcher browser select <ref> <value>... [--tab <tab-id>]",
      },
      {
        name: "check",
        summary: "Make sure a checkbox or radio is checked",
        usage: "patcher browser check <ref> [--tab <tab-id>]",
      },
      {
        name: "uncheck",
        summary: "Make sure a checkbox is unchecked",
        usage: "patcher browser uncheck <ref> [--tab <tab-id>]",
      },
      {
        name: "upload",
        summary: "Hand a file input one or more local files",
        usage: "patcher browser upload <ref> <path>... [--tab <tab-id>]",
      },
      {
        name: "resize",
        summary: "Emulate a viewport size, or reset it",
        usage:
          "patcher browser resize <width> <height> | reset [--tab <tab-id>]",
      },
      {
        name: "dialog",
        summary: "Answer a JavaScript dialog blocking a page",
        usage:
          "patcher browser dialog <accept|dismiss> [text] [--tab <tab-id>]",
      },
      {
        name: "tabs",
        summary: "List the browser's open tabs",
        usage: "patcher browser tabs [--json]",
      },
      {
        name: "open",
        summary: "Open a URL in the browser",
        usage:
          "patcher browser open <url> [--tab <tab-id>] [--new-tab] [--json]",
      },
      {
        name: "close",
        summary: "Close a browser tab",
        usage: "patcher browser close <tab-id> [--json]",
      },
      {
        name: "activate",
        summary: "Bring a browser tab to the front",
        usage: "patcher browser activate <tab-id> [--json]",
      },
      {
        name: "url",
        summary: "Show the URL a browser tab is on",
        usage: "patcher browser url [--tab <tab-id>]",
      },
      {
        name: "title",
        summary: "Show the title of a browser tab's page",
        usage: "patcher browser title [--tab <tab-id>]",
      },
      {
        name: "text",
        summary: "Read the visible text of a browser tab's page",
        usage: "patcher browser text [--tab <tab-id>] [--max <n>]",
      },
      {
        name: "selection",
        summary: "Read the text selected in a browser tab",
        usage: "patcher browser selection [--tab <tab-id>]",
      },
      {
        name: "screenshot",
        summary: "Write a picture of a tab's page to a file",
        usage:
          "patcher browser screenshot <file> [--full-page] [--tab <tab-id>]",
      },
      {
        name: "pdf",
        summary: "Print a tab's page to a PDF file",
        usage: "patcher browser pdf <file> [--tab <tab-id>]",
      },
      {
        name: "console",
        summary: "Show what the page has logged to its console",
        usage: "patcher browser console [--tab <tab-id>] [--max <n>] [--json]",
      },
      {
        name: "network",
        summary: "Show what the tab has requested",
        usage: "patcher browser network [--tab <tab-id>] [--max <n>] [--json]",
      },
      {
        name: "cookie-list",
        summary: "List the cookies a tab's URL carries, with their values",
        usage: "patcher browser cookie-list [--tab <tab-id>] [--json]",
      },
      {
        name: "cookie-get",
        summary: "Show one cookie of a tab's URL",
        usage: "patcher browser cookie-get <name> [--tab <tab-id>] [--json]",
      },
      {
        name: "cookie-set",
        summary: "Set a cookie on a tab's URL",
        usage: "patcher browser cookie-set <name> <value> [--tab <tab-id>]",
      },
      {
        name: "cookie-delete",
        summary: "Remove one cookie from a tab's URL",
        usage: "patcher browser cookie-delete <name> [--tab <tab-id>]",
      },
      {
        name: "cookie-clear",
        summary: "Remove every cookie a tab's URL carries",
        usage: "patcher browser cookie-clear [--tab <tab-id>]",
      },
      {
        name: "localstorage-list",
        summary: "List a page's localStorage",
        usage: "patcher browser localstorage-list [--tab <tab-id>] [--json]",
      },
      {
        name: "localstorage-get",
        summary: "Read one localStorage key",
        usage: "patcher browser localstorage-get <key> [--tab <tab-id>]",
      },
      {
        name: "localstorage-set",
        summary: "Write one localStorage key",
        usage:
          "patcher browser localstorage-set <key> <value> [--tab <tab-id>]",
      },
      {
        name: "localstorage-delete",
        summary: "Remove one localStorage key",
        usage: "patcher browser localstorage-delete <key> [--tab <tab-id>]",
      },
      {
        name: "localstorage-clear",
        summary: "Empty a page's localStorage",
        usage: "patcher browser localstorage-clear [--tab <tab-id>]",
      },
      {
        name: "sessionstorage-list",
        summary: "List a page's sessionStorage",
        usage: "patcher browser sessionstorage-list [--tab <tab-id>] [--json]",
      },
      {
        name: "sessionstorage-get",
        summary: "Read one sessionStorage key",
        usage: "patcher browser sessionstorage-get <key> [--tab <tab-id>]",
      },
      {
        name: "sessionstorage-set",
        summary: "Write one sessionStorage key",
        usage:
          "patcher browser sessionstorage-set <key> <value> [--tab <tab-id>]",
      },
      {
        name: "sessionstorage-delete",
        summary: "Remove one sessionStorage key",
        usage: "patcher browser sessionstorage-delete <key> [--tab <tab-id>]",
      },
      {
        name: "sessionstorage-clear",
        summary: "Empty a page's sessionStorage",
        usage: "patcher browser sessionstorage-clear [--tab <tab-id>]",
      },
      {
        name: "state-save",
        summary: "Save a tab's cookies and localStorage as a signed-in session",
        usage: "patcher browser state-save [file] [--tab <tab-id>]",
      },
      {
        name: "state-load",
        summary: "Write a saved session back into a tab",
        usage: "patcher browser state-load <file> [--tab <tab-id>]",
      },
      {
        name: "eval",
        summary:
          "Run a JavaScript function in the page and print what it returned",
        usage:
          'patcher browser eval "<function>" [<ref>] [--tab <tab-id>] [--generation <n>]',
      },
      {
        name: "mousemove",
        summary: "Move the pointer to viewport coordinates",
        usage: "patcher browser mousemove <x> <y> [--tab <tab-id>]",
      },
      {
        name: "mousedown",
        summary: "Press a mouse button where the pointer is",
        usage: "patcher browser mousedown [left|middle|right] [--tab <tab-id>]",
      },
      {
        name: "mouseup",
        summary: "Release a mouse button where the pointer is",
        usage: "patcher browser mouseup [left|middle|right] [--tab <tab-id>]",
      },
      {
        name: "mousewheel",
        summary: "Scroll by a delta where the pointer is",
        usage: "patcher browser mousewheel <dx> <dy> [--tab <tab-id>]",
      },
      {
        name: "route",
        summary:
          "Answer requests matching a URL pattern instead of fetching them",
        usage:
          'patcher browser route <pattern> [--status <n>] [--body <text>] [--content-type <t>] [--header "N: v"] [--tab <tab-id>]',
      },
      {
        name: "route-list",
        summary: "Show what a tab is mocking and how often each route fired",
        usage: "patcher browser route-list [--tab <tab-id>] [--json]",
      },
      {
        name: "unroute",
        summary: "Remove one route, or every route on a tab",
        usage: "patcher browser unroute [<pattern>] [--tab <tab-id>]",
      },
      {
        name: "network-state-set",
        summary: "Take a tab offline, or put it back online",
        usage:
          "patcher browser network-state-set <offline|online> [--tab <tab-id>]",
      },
      {
        name: "tracing-start",
        summary: "Start logging the browser commands Patcher runs",
        usage: "patcher browser tracing-start [--screenshots]",
      },
      {
        name: "tracing-stop",
        summary: "Stop the log and write it out",
        usage: "patcher browser tracing-stop [<dir>]",
      },
      {
        name: "video-start",
        summary: "Start filming a tab",
        usage: "patcher browser video-start [--fps <n>] [--tab <tab-id>]",
      },
      {
        name: "video-chapter",
        summary: "Mark a moment in the film",
        usage: "patcher browser video-chapter <title> [--tab <tab-id>]",
      },
      {
        name: "video-stop",
        summary: "Stop filming and write the frames to a directory",
        usage: "patcher browser video-stop <dir> [--encode] [--tab <tab-id>]",
      },
      {
        name: "install-ffmpeg",
        summary: "Install the video encoder with Homebrew (Patcher ships none)",
        usage: "patcher browser install-ffmpeg",
      },
      {
        name: "back",
        summary: "Go back in a browser tab's history",
        usage: "patcher browser back [--tab <tab-id>] [--json]",
      },
      {
        name: "forward",
        summary: "Go forward in a browser tab's history",
        usage: "patcher browser forward [--tab <tab-id>] [--json]",
      },
      {
        name: "reload",
        summary: "Reload a browser tab",
        usage: "patcher browser reload [--tab <tab-id>] [--json]",
      },
    ],
    async run(argv, context): Promise<PluginCliResult> {
      const parsed = parseArgs(argv);
      if ("error" in parsed) {
        return { exitCode: 2, stderr: `${parsed.error}\n\n${USAGE}` };
      }
      const [command, ...rest] = parsed.positionals;
      if (command === undefined || command === "help") {
        return { exitCode: command === undefined ? 2 : 0, stdout: USAGE };
      }

      // The invoking CLI's request signal, so Ctrl-C stops the wait rather than
      // leaving the command hanging on a page that never loads.
      const options = { signal: context.signal };

      /** Every interaction reports the same thing: where the tab ended up. */
      const act = async (
        action: PluginBrowserAction,
      ): Promise<PluginCliResult> => {
        const state = await patcher.browser.page.act(
          { action, tabId: parsed.tabId, generation: parsed.generation },
          options,
        );
        return { exitCode: 0, stdout: renderPageState(state, parsed.json) };
      };
      const requireRef = (value: string | undefined): string | null =>
        value === undefined || value.length === 0 ? null : value;

      try {
        switch (command) {
          case "status": {
            const status = patcher.browser.getStatus();
            if (parsed.json) {
              return { exitCode: 0, stdout: `${JSON.stringify(status)}\n` };
            }
            return {
              exitCode: status.connected ? 0 : 1,
              stdout: status.connected
                ? `Connected (${status.windowCount} window${status.windowCount === 1 ? "" : "s"}).\n`
                : "No browser window is connected. Open the Patcher desktop app.\n",
            };
          }

          case "snapshot": {
            const result = await patcher.browser.page.snapshot(
              {
                tabId: parsed.tabId,
                maxDepth: parsed.max,
                selector: parsed.selector,
              },
              options,
            );
            if (parsed.json) {
              return {
                exitCode: 0,
                stdout: `${JSON.stringify(result, null, 2)}\n`,
              };
            }
            // The generation goes to stderr so stdout stays the tree alone and
            // can be piped, while a human still sees the number the interaction
            // commands want back.
            return {
              exitCode: 0,
              stdout: `${result.snapshot}\n`,
              stderr: `generation ${result.generation}\n${
                result.truncated ? "(truncated)\n" : ""
              }`,
            };
          }

          case "click":
          case "hover":
          case "check":
          case "uncheck": {
            const ref = requireRef(rest[0]);
            if (ref === null) {
              return { exitCode: 2, stderr: "A ref is required.\n" };
            }
            if (command === "hover") {
              return await act({ action: "hover", ref });
            }
            if (command === "click") {
              return await act({
                action: "click",
                ref,
                button: parsed.button,
                clickCount: parsed.double ? 2 : 1,
                modifiers: parsed.modifiers,
              });
            }
            return await act({
              action: "check",
              ref,
              checked: command === "check",
            });
          }

          case "drag": {
            const ref = requireRef(rest[0]);
            const targetRef = requireRef(rest[1]);
            if (ref === null || targetRef === null) {
              return {
                exitCode: 2,
                stderr: "Both a source ref and a target ref are required.\n",
              };
            }
            return await act({ action: "drag", ref, targetRef });
          }

          case "fill":
          case "type": {
            const ref = requireRef(rest[0]);
            if (ref === null) {
              return { exitCode: 2, stderr: "A ref is required.\n" };
            }
            // Everything after the ref, so unquoted multi-word text still works.
            const text = rest.slice(1).join(" ");
            return await act({ action: command, ref, text });
          }

          case "press": {
            const key = requireRef(rest[0]);
            if (key === null) {
              return { exitCode: 2, stderr: "A key is required.\n" };
            }
            const ref = requireRef(rest[1]);
            return await act({
              action: "press",
              key,
              ...(ref === null ? {} : { ref }),
            });
          }

          case "select": {
            const ref = requireRef(rest[0]);
            const values = rest.slice(1);
            if (ref === null || values.length === 0) {
              return {
                exitCode: 2,
                stderr: "A ref and at least one value are required.\n",
              };
            }
            return await act({ action: "select", ref, values });
          }

          case "upload": {
            const ref = requireRef(rest[0]);
            const paths = rest.slice(1);
            if (ref === null || paths.length === 0) {
              return {
                exitCode: 2,
                stderr: "A ref and at least one file path are required.\n",
              };
            }
            return await act({ action: "upload", ref, paths });
          }

          case "resize": {
            if (rest[0] === "reset") {
              return await act({ action: "resize", width: 0, height: 0 });
            }
            const width = Number(rest[0]);
            const height = Number(rest[1]);
            if (
              !Number.isInteger(width) ||
              !Number.isInteger(height) ||
              width < 1 ||
              height < 1
            ) {
              return {
                exitCode: 2,
                stderr: "A width and a height in pixels are required.\n",
              };
            }
            return await act({ action: "resize", width, height });
          }

          case "dialog": {
            const action = rest[0];
            if (action !== "accept" && action !== "dismiss") {
              return {
                exitCode: 2,
                stderr:
                  "Usage: patcher browser dialog <accept|dismiss> [text]\n",
              };
            }
            const answered = await patcher.browser.page.handleDialog(
              {
                accept: action === "accept",
                tabId: parsed.tabId,
                promptText: rest[1],
              },
              options,
            );
            return {
              exitCode: answered ? 0 : 1,
              stdout: answered
                ? `Dialog ${action === "accept" ? "accepted" : "dismissed"}.\n`
                : "No dialog was waiting on that tab.\n",
            };
          }

          case "tabs": {
            const tabs = await patcher.browser.tabs.list(options);
            return { exitCode: 0, stdout: renderTabs(tabs, parsed.json) };
          }

          case "open": {
            const url = rest[0];
            if (url === undefined) {
              return { exitCode: 2, stderr: "A URL is required.\n" };
            }
            const tab = parsed.newTab
              ? await patcher.browser.tabs.open(
                  { url, activate: true },
                  options,
                )
              : await patcher.browser.navigation.open(
                  { url, tabId: parsed.tabId },
                  options,
                );
            return { exitCode: 0, stdout: renderTab(tab, parsed.json) };
          }

          case "close": {
            const tabId = rest[0];
            if (tabId === undefined) {
              return { exitCode: 2, stderr: "A tab id is required.\n" };
            }
            const result = await patcher.browser.tabs.close({ tabId }, options);
            return {
              exitCode: 0,
              stdout: parsed.json
                ? `${JSON.stringify(result, null, 2)}\n`
                : `Closed ${result.closedTabId}.\n${renderTabs(result.tabs, false)}`,
            };
          }

          case "activate": {
            const tabId = rest[0];
            if (tabId === undefined) {
              return { exitCode: 2, stderr: "A tab id is required.\n" };
            }
            const tab = await patcher.browser.tabs.activate({ tabId }, options);
            return { exitCode: 0, stdout: renderTab(tab, parsed.json) };
          }

          case "url": {
            const url = await patcher.browser.page.getUrl(
              { tabId: parsed.tabId },
              options,
            );
            return { exitCode: 0, stdout: `${url}\n` };
          }

          case "title": {
            const title = await patcher.browser.page.getTitle(
              { tabId: parsed.tabId },
              options,
            );
            return { exitCode: 0, stdout: `${title ?? ""}\n` };
          }

          case "text": {
            const result = await patcher.browser.page.getText(
              {
                tabId: parsed.tabId,
                maxLength: parsed.max ?? DEFAULT_PAGE_TEXT_MAX_LENGTH,
              },
              options,
            );
            if (parsed.json) {
              return { exitCode: 0, stdout: `${JSON.stringify(result)}\n` };
            }
            return {
              exitCode: 0,
              stdout: `${result.text}\n`,
              stderr: result.truncated ? "(truncated)\n" : undefined,
            };
          }

          case "selection": {
            const result = await patcher.browser.page.getSelection(
              { tabId: parsed.tabId },
              options,
            );
            return { exitCode: 0, stdout: `${result.text}\n` };
          }

          case "screenshot":
          case "pdf": {
            const target = rest[0];
            if (target === undefined || target.length === 0) {
              return { exitCode: 2, stderr: "A file path is required.\n" };
            }
            // Relative to the shell that ran `patcher`, not to the server process
            // this handler happens to live in.
            const path = isAbsolute(target)
              ? target
              : resolve(context.cwd ?? process.cwd(), target);
            // Both are slower than a command that only reads state — rendering a
            // long page to PDF especially — so neither rides the default wait.
            const capture =
              command === "pdf"
                ? await patcher.browser.page.pdf(
                    { tabId: parsed.tabId },
                    { ...options, timeoutMs: 60_000 },
                  )
                : await patcher.browser.page.screenshot(
                    {
                      tabId: parsed.tabId,
                      format: target.endsWith(".png") ? "png" : "jpeg",
                      fullPage: parsed.fullPage,
                    },
                    { ...options, timeoutMs: 30_000 },
                  );
            const bytes = Buffer.from(capture.base64, "base64");
            await writeFile(path, bytes);
            return {
              exitCode: 0,
              stdout: `${path}\t${bytes.byteLength} bytes\n`,
              // A picture that stops short of the page is still worth having,
              // but only if whoever opens it knows that is what it is.
              ...("truncated" in capture && capture.truncated
                ? {
                    stderr:
                      "That page is longer than one capture can hold; this is its top.\n",
                  }
                : {}),
            };
          }

          case "console": {
            return renderLog(
              await patcher.browser.page.console(
                { tabId: parsed.tabId, limit: parsed.max },
                options,
              ),
              consoleLine,
              parsed.json,
              "That page has logged nothing.",
            );
          }

          case "network": {
            return renderLog(
              await patcher.browser.page.network(
                { tabId: parsed.tabId, limit: parsed.max },
                options,
              ),
              networkLine,
              parsed.json,
              "That tab has requested nothing.",
            );
          }

          case "cookie-list":
          case "cookie-get": {
            const name = rest[0];
            if (command === "cookie-get" && name === undefined) {
              return { exitCode: 2, stderr: "A cookie name is required.\n" };
            }
            const { cookies } = await patcher.browser.storage.cookies(
              { tabId: parsed.tabId },
              options,
            );
            return renderList(
              name === undefined
                ? cookies
                : cookies.filter((cookie) => cookie.name === name),
              cookieLine,
              parsed.json,
              "No cookies for that URL.",
            );
          }

          case "cookie-set": {
            const name = rest[0];
            if (name === undefined || name.length === 0) {
              return {
                exitCode: 2,
                stderr: "A cookie name and value are required.\n",
              };
            }
            // Everything after the name, so an unquoted value with spaces in it
            // still arrives whole — the same rule `fill` follows.
            const written = await patcher.browser.storage.setCookies(
              {
                cookies: [{ name, value: rest.slice(1).join(" ") }],
                tabId: parsed.tabId,
              },
              options,
            );
            return {
              exitCode: written.applied === 1 ? 0 : 1,
              stdout:
                written.applied === 1
                  ? `Set ${name}.\n`
                  : `The browser refused ${name}.\n`,
            };
          }

          case "cookie-delete":
          case "cookie-clear": {
            const name = rest[0];
            if (command === "cookie-delete" && name === undefined) {
              return { exitCode: 2, stderr: "A cookie name is required.\n" };
            }
            const { removed } = await patcher.browser.storage.clearCookies(
              {
                ...(command === "cookie-delete" ? { name } : {}),
                tabId: parsed.tabId,
              },
              options,
            );
            return {
              exitCode: 0,
              stdout: `Removed ${removed} cookie${removed === 1 ? "" : "s"}.\n`,
            };
          }

          case "localstorage-list":
          case "sessionstorage-list":
          case "localstorage-get":
          case "sessionstorage-get": {
            const area: PluginBrowserStorageArea = command.startsWith("local")
              ? "local"
              : "session";
            const key = rest[0];
            if (command.endsWith("-get") && key === undefined) {
              return { exitCode: 2, stderr: "A key is required.\n" };
            }
            const result = await patcher.browser.storage.items(
              { area, tabId: parsed.tabId },
              options,
            );
            const shown =
              key === undefined
                ? result.items
                : result.items.filter((item) => item.name === key);
            const listed = renderList(
              shown,
              itemLine,
              parsed.json,
              "That page has stored nothing there.",
            );
            return {
              ...listed,
              // The same honesty the log commands owe: a caller that saw only
              // part of an origin's storage must be told so.
              stderr: result.truncated
                ? "(this page holds more than the bridge will carry)\n"
                : undefined,
            };
          }

          case "localstorage-set":
          case "sessionstorage-set": {
            const area: PluginBrowserStorageArea = command.startsWith("local")
              ? "local"
              : "session";
            const key = rest[0];
            if (key === undefined || key.length === 0) {
              return {
                exitCode: 2,
                stderr: "A key and a value are required.\n",
              };
            }
            const written = await patcher.browser.storage.setItems(
              {
                area,
                items: [{ name: key, value: rest.slice(1).join(" ") }],
                tabId: parsed.tabId,
              },
              options,
            );
            return {
              exitCode: written.applied === 1 ? 0 : 1,
              stdout:
                written.applied === 1
                  ? `Set ${key}.\n`
                  : `The page refused ${key} — it may be out of storage quota.\n`,
            };
          }

          case "localstorage-delete":
          case "sessionstorage-delete":
          case "localstorage-clear":
          case "sessionstorage-clear": {
            const area: PluginBrowserStorageArea = command.startsWith("local")
              ? "local"
              : "session";
            const key = rest[0];
            if (command.endsWith("-delete") && key === undefined) {
              return { exitCode: 2, stderr: "A key is required.\n" };
            }
            const { removed } = await patcher.browser.storage.clearItems(
              {
                area,
                ...(command.endsWith("-delete") ? { name: key } : {}),
                tabId: parsed.tabId,
              },
              options,
            );
            return {
              exitCode: 0,
              stdout: `Removed ${removed} item${removed === 1 ? "" : "s"}.\n`,
            };
          }

          case "state-save": {
            const cookies = await patcher.browser.storage.cookies(
              { tabId: parsed.tabId },
              options,
            );
            const stored = await patcher.browser.storage.items(
              { area: "local", tabId: parsed.tabId },
              options,
            );
            const origin = originOf(cookies.url);
            const state: BrowserStorageStateFile = {
              cookies: cookies.cookies,
              origins:
                origin === null ? [] : [{ origin, localStorage: stored.items }],
            };
            const json = `${JSON.stringify(state, null, 2)}\n`;
            // A state file is the session it came from. Saying so on stderr
            // keeps stdout usable while making sure nobody learns it later.
            const warning = `${
              stored.truncated
                ? "Incomplete: this origin holds more localStorage than the bridge will carry.\n"
                : ""
            }This is a signed-in session, not a settings dump — treat the output as a credential.\n`;
            const target = rest[0];
            if (target === undefined || target.length === 0) {
              return { exitCode: 0, stdout: json, stderr: warning };
            }
            const path = isAbsolute(target)
              ? target
              : resolve(context.cwd ?? process.cwd(), target);
            await writeFile(path, json, "utf8");
            return {
              exitCode: 0,
              stdout: `${path}\t${state.cookies.length} cookies, ${stored.items.length} localStorage items\n`,
              stderr: warning,
            };
          }

          case "state-load": {
            const target = rest[0];
            if (target === undefined || target.length === 0) {
              return { exitCode: 2, stderr: "A file path is required.\n" };
            }
            const path = isAbsolute(target)
              ? target
              : resolve(context.cwd ?? process.cwd(), target);
            const state = parseStorageStateFile(await readFile(path, "utf8"));
            if (state === null) {
              return {
                exitCode: 2,
                stderr: `${path} is not a storage state file.\n`,
              };
            }
            const cookies =
              state.cookies.length === 0
                ? { applied: 0, rejected: 0 }
                : await patcher.browser.storage.setCookies(
                    { cookies: state.cookies, tabId: parsed.tabId },
                    options,
                  );
            // localStorage belongs to an origin, and this tab is on one origin.
            // Loading the rest would mean navigating the user's browser around
            // their saved sites, so the other origins are reported instead.
            const url = await patcher.browser.page.getUrl(
              { tabId: parsed.tabId },
              options,
            );
            const origin = originOf(url);
            const match = state.origins.find(
              (entry) => entry.origin === origin,
            );
            const items = match?.localStorage ?? [];
            const written =
              items.length === 0
                ? { applied: 0, rejected: 0 }
                : await patcher.browser.storage.setItems(
                    { area: "local", items, tabId: parsed.tabId },
                    options,
                  );
            const skipped = state.origins.filter(
              (entry) => entry.origin !== origin,
            ).length;
            return {
              exitCode: 0,
              stdout: `${cookies.applied} cookies applied, ${cookies.rejected} rejected.\n${written.applied} localStorage items applied for ${origin ?? "this tab"}.\n`,
              stderr:
                skipped === 0
                  ? undefined
                  : `${skipped} other origin${skipped === 1 ? "" : "s"} in that file were skipped — open a tab there and load it again.\n`,
            };
          }

          case "eval": {
            const expression = rest[0];
            if (expression === undefined || expression.length === 0) {
              return {
                exitCode: 2,
                stderr:
                  'A function is required, e.g. patcher browser eval "() => document.title"\n',
              };
            }
            const result = await patcher.browser.control.evaluate(
              {
                expression,
                ref: rest[1],
                tabId: parsed.tabId,
                generation: parsed.generation,
              },
              options,
            );
            if (parsed.json) {
              return {
                exitCode: 0,
                stdout: `${JSON.stringify(result, null, 2)}\n`,
              };
            }
            return {
              exitCode: 0,
              stdout: `${result.value}\n`,
              stderr: result.truncated ? "(truncated)\n" : undefined,
            };
          }

          case "mousemove": {
            const x = Number(rest[0]);
            const y = Number(rest[1]);
            if (!Number.isInteger(x) || !Number.isInteger(y)) {
              return {
                exitCode: 2,
                stderr: "An x and a y in viewport pixels are required.\n",
              };
            }
            const state = await patcher.browser.control.mouseMove(
              { x, y, tabId: parsed.tabId },
              options,
            );
            return { exitCode: 0, stdout: renderPageState(state, parsed.json) };
          }

          case "mousedown":
          case "mouseup": {
            const named = rest[0];
            if (
              named !== undefined &&
              named !== "left" &&
              named !== "middle" &&
              named !== "right"
            ) {
              return {
                exitCode: 2,
                stderr: "A button is left, middle or right.\n",
              };
            }
            const state = await patcher.browser.control.mouseButton(
              {
                down: command === "mousedown",
                button: named ?? parsed.button,
                tabId: parsed.tabId,
              },
              options,
            );
            return { exitCode: 0, stdout: renderPageState(state, parsed.json) };
          }

          case "mousewheel": {
            const deltaX = Number(rest[0]);
            const deltaY = Number(rest[1]);
            if (!Number.isInteger(deltaX) || !Number.isInteger(deltaY)) {
              return {
                exitCode: 2,
                stderr: "A horizontal and a vertical delta are required.\n",
              };
            }
            const state = await patcher.browser.control.mouseWheel(
              { deltaX, deltaY, tabId: parsed.tabId },
              options,
            );
            return { exitCode: 0, stdout: renderPageState(state, parsed.json) };
          }

          case "route": {
            const pattern = rest[0];
            if (pattern === undefined || pattern.length === 0) {
              return {
                exitCode: 2,
                stderr:
                  'A URL pattern is required, e.g. patcher browser route "**/api/me" --body "{}"\n',
              };
            }
            return renderRoutes(
              await patcher.browser.control.route(
                {
                  pattern,
                  status: parsed.status,
                  body: parsed.body,
                  contentType: parsed.contentType,
                  headers: parsed.headers,
                  tabId: parsed.tabId,
                },
                options,
              ),
              parsed.json,
            );
          }

          case "route-list": {
            return renderRoutes(
              await patcher.browser.control.routes(
                { tabId: parsed.tabId },
                options,
              ),
              parsed.json,
            );
          }

          case "unroute": {
            return renderRoutes(
              await patcher.browser.control.unroute(
                { pattern: rest[0], tabId: parsed.tabId },
                options,
              ),
              parsed.json,
            );
          }

          case "network-state-set": {
            const state = rest[0];
            if (state !== "offline" && state !== "online") {
              return {
                exitCode: 2,
                stderr:
                  "Usage: patcher browser network-state-set <offline|online>\n",
              };
            }
            const page = await patcher.browser.control.setOffline(
              { offline: state === "offline", tabId: parsed.tabId },
              options,
            );
            return {
              exitCode: 0,
              stdout: parsed.json
                ? renderPageState(page, true)
                : `That tab is now ${state}.\n`,
            };
          }

          case "tracing-start": {
            await patcher.browser.recording.traceStart(
              { screenshots: parsed.screenshots },
              options,
            );
            return {
              exitCode: 0,
              stdout: `Tracing. Everything Patcher drives from here is recorded${
                parsed.screenshots ? ", with a picture after each step" : ""
              }; tracing-stop is how you read it.\n`,
            };
          }

          case "tracing-stop": {
            const trace = await patcher.browser.recording.traceStop(options);
            const missing =
              trace.droppedSteps + trace.droppedImages === 0
                ? undefined
                : `Dropped ${trace.droppedSteps} steps and ${trace.droppedImages} images past the recording's caps.\n`;
            const target = rest[0];
            if (target === undefined || target.length === 0) {
              // Without somewhere to put the images, they are left out rather
              // than printed: nobody reads base64 in a terminal.
              return {
                exitCode: 0,
                stdout: `${JSON.stringify(
                  {
                    ...trace,
                    steps: trace.steps.map((step) => ({
                      ...step,
                      image: step.image === null ? null : "(omitted)",
                    })),
                  },
                  null,
                  2,
                )}\n`,
                stderr: missing,
              };
            }
            return {
              exitCode: 0,
              stdout: await writeTrace(
                isAbsolute(target)
                  ? target
                  : resolve(context.cwd ?? process.cwd(), target),
                trace,
              ),
              stderr: missing,
            };
          }

          case "video-start": {
            await patcher.browser.recording.videoStart(
              { fps: parsed.fps, tabId: parsed.tabId },
              options,
            );
            return {
              exitCode: 0,
              stdout:
                "Filming. The tab has to stay visible — a hidden view paints nothing to record.\n",
            };
          }

          case "video-chapter": {
            const title = rest.join(" ");
            if (title.length === 0) {
              return {
                exitCode: 2,
                stderr: "Usage: patcher browser video-chapter <title>\n",
              };
            }
            await patcher.browser.recording.videoChapter(
              { title, tabId: parsed.tabId },
              options,
            );
            return { exitCode: 0, stdout: `Marked "${title}".\n` };
          }

          case "video-stop": {
            const target = rest[0];
            if (target === undefined || target.length === 0) {
              return {
                exitCode: 2,
                stderr:
                  "A directory is required: patcher browser video-stop <dir>\n",
              };
            }
            const video = await patcher.browser.recording.videoStop(
              { tabId: parsed.tabId },
              // Handing over every frame takes longer than any other command
              // here, and the wait is proportional to how long it filmed.
              { ...options, timeoutMs: 60_000 },
            );
            const directory = isAbsolute(target)
              ? target
              : resolve(context.cwd ?? process.cwd(), target);
            const written = await writeVideo(directory, video);
            const playlist = join(directory, "frames.txt");
            const dropped =
              video.droppedFrames === 0
                ? ""
                : `${video.droppedFrames} frames were dropped by the pacing and the caps.\n`;

            if (!parsed.encode) {
              return {
                exitCode: 0,
                stdout: written,
                // The frames are frames. Saying how to make them a video
                // belongs here rather than in a doc nobody has open at this
                // moment.
                stderr: `${dropped}Encode with --encode, or yourself: ffmpeg ${ffmpegEncodeArgs(playlist, join(directory, "video.mp4")).join(" ")}\n`,
              };
            }

            // Patcher ships no encoder and downloads none; see ffmpeg.ts. The frames
            // are already on disk either way, so a missing ffmpeg costs the
            // convenience and not the recording.
            const ffmpeg = await resolveFfmpeg(process.env);
            if (ffmpeg === null) {
              return {
                exitCode: 1,
                stdout: written,
                stderr: `${dropped}${NO_FFMPEG_MESSAGE}\n`,
              };
            }
            const output = join(directory, "video.mp4");
            const encoded = await encodeBrowserVideo({
              ffmpeg,
              playlist,
              output,
              ...(context.signal === undefined
                ? {}
                : { signal: context.signal }),
            });
            if (!encoded.ok) {
              // The frames survive a failed encode, and saying so is what stops
              // someone re-recording a session they still have.
              return {
                exitCode: 1,
                stdout: written,
                stderr: `${dropped}The frames are written, but ffmpeg would not encode them: ${encoded.message}\n`,
              };
            }
            return {
              exitCode: 0,
              stdout: `${written}${output}\t${encoded.byteLength} bytes\n`,
              stderr: dropped,
            };
          }

          case "install-ffmpeg": {
            const existing = await resolveFfmpeg(process.env);
            if (existing !== null) {
              return {
                exitCode: 0,
                stdout: `ffmpeg is already here: ${existing}\n`,
              };
            }
            const brew = await resolveBrew(process.env);
            if (brew === null) {
              return {
                exitCode: 1,
                stderr:
                  "No Homebrew here to install it with. Install ffmpeg however this machine installs things, then point PATCHER_FFMPEG at it if it is somewhere unusual.\n",
              };
            }
            // On the server's machine, which on a remote server is not the one
            // the terminal is on. Worth saying before minutes pass.
            const installed = await installFfmpegWithBrew({
              brew,
              ...(context.signal === undefined
                ? {}
                : { signal: context.signal }),
            });
            if (!installed.ok) {
              return {
                exitCode: 1,
                stderr: `${brew} install ffmpeg failed: ${installed.message}\n`,
              };
            }
            const found = await resolveFfmpeg(process.env);
            return found === null
              ? {
                  exitCode: 1,
                  stdout: `${installed.output}\n`,
                  stderr:
                    "Homebrew finished, but no working ffmpeg turned up. Point PATCHER_FFMPEG at one.\n",
                }
              : { exitCode: 0, stdout: `ffmpeg is ready: ${found}\n` };
          }

          case "back":
          case "forward":
          case "reload": {
            const tab = await patcher.browser.navigation[command](
              { tabId: parsed.tabId },
              options,
            );
            return { exitCode: 0, stdout: renderTab(tab, parsed.json) };
          }

          default:
            return {
              exitCode: 2,
              stderr: `Unknown command "${command}".\n\n${USAGE}`,
            };
        }
      } catch (error) {
        // Same explanations the agent tools give, so a failure reads the same
        // way in a terminal as it does in a thread.
        return { exitCode: 1, stderr: `${explainBrowserError(error)}\n` };
      }
    },
  });
}
