import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Turning a recording's frames into a video, with an encoder Patcher does not ship.
 *
 * The decision behind this file: Patcher does not bundle ffmpeg and does not
 * download one. A bundled binary is 40–80MB in every auto-update payload, a
 * GPL build inside a proprietary distribution, and one more thing to sign; a
 * downloaded one is worse, because Patcher would be executing a binary that was
 * never part of a Patcher release. The audience here runs `patcher` in a terminal and
 * their agents have shell access, so the honest answer is to use the ffmpeg
 * they have — and to make its absence a message that fixes itself rather than a
 * dead end.
 *
 * Nothing here is on the recording path. `video-stop` writes frames and a
 * playlist whether or not an encoder exists anywhere; encoding is `--encode`,
 * and it is a convenience over an artifact that is already complete.
 */

/** Point at a specific binary; absolute, like every other Patcher path override. */
export const PATCHER_FFMPEG_ENV_VAR = "PATCHER_FFMPEG";

/** A `brew install` can download or compile; it must not die at 30 seconds. */
export const FFMPEG_INSTALL_TIMEOUT_MS = 900_000;
const PROBE_TIMEOUT_MS = 5_000;
const ENCODE_TIMEOUT_MS = 300_000;
const OUTPUT_MAX_BYTES = 1_048_576;

/**
 * Ordered places to look for a binary, most authoritative first.
 *
 * The bare name is in the list rather than being the whole of it, and that is
 * the point: a server started from a macOS GUI inherits `/usr/bin:/bin` and
 * nothing else, so `PATH` alone finds neither Homebrew's ffmpeg nor Homebrew.
 * The plugin that runs user scripts hit this and wrote it down; this is the
 * same lesson applied to a different binary.
 *
 * A relative override is skipped rather than resolved against the process cwd,
 * which is the server's and has nothing to do with the caller's.
 */
function binaryCandidates(
  name: string,
  override: string | undefined,
): string[] {
  const candidates: string[] = [];
  if (override !== undefined && override.length > 0 && isAbsolute(override)) {
    candidates.push(override);
  }
  candidates.push(name, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`);
  return candidates;
}

export function ffmpegCandidates(env: NodeJS.ProcessEnv): string[] {
  return binaryCandidates("ffmpeg", env[PATCHER_FFMPEG_ENV_VAR]);
}

export function brewCandidates(env: NodeJS.ProcessEnv): string[] {
  return binaryCandidates("brew", env.PATCHER_BREW);
}

/**
 * The first candidate that answers `--version`, or null.
 *
 * Running the binary is the probe, not checking that a file exists: a path can
 * exist and be the wrong architecture, and the failure we want to report is
 * "there is no working ffmpeg here", not "there is a file called ffmpeg".
 */
export async function probeBinaries(
  candidates: string[],
): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["-version"], {
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: OUTPUT_MAX_BYTES,
      });
      return candidate;
    } catch {
      // Missing, not executable, or not the thing we hoped: try the next.
    }
  }
  return null;
}

export function resolveFfmpeg(env: NodeJS.ProcessEnv): Promise<string | null> {
  return probeBinaries(ffmpegCandidates(env));
}

export function resolveBrew(env: NodeJS.ProcessEnv): Promise<string | null> {
  return probeBinaries(brewCandidates(env));
}

/**
 * The encode, as arguments rather than a command line.
 *
 * `-vf scale=trunc(iw/2)*2:trunc(ih/2)*2` is not decoration. Chromium scales a
 * screencast frame to fit the cap while keeping the aspect ratio, so a 960-wide
 * frame is routinely an odd number of pixels tall — and H.264 with `yuv420p`
 * refuses odd dimensions outright. Without this, encoding fails on exactly the
 * recordings people make.
 *
 * The playlist carries each frame's duration, so the timing comes from the file
 * rather than from a frame rate asserted here.
 */
export function ffmpegEncodeArgs(playlist: string, output: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-i",
    playlist,
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-pix_fmt",
    "yuv420p",
    output,
  ];
}

export type FfmpegEncodeOutcome =
  | { ok: true; byteLength: number }
  | { ok: false; message: string };

/**
 * Run the encode and confirm it produced something.
 *
 * The existence check is the part worth keeping: ffmpeg can exit 0 having
 * written nothing a player will open, and reporting a path that is not there is
 * worse than reporting the failure.
 */
export async function encodeBrowserVideo(args: {
  ffmpeg: string;
  playlist: string;
  output: string;
  signal?: AbortSignal;
}): Promise<FfmpegEncodeOutcome> {
  try {
    await execFileAsync(
      args.ffmpeg,
      ffmpegEncodeArgs(args.playlist, args.output),
      {
        timeout: ENCODE_TIMEOUT_MS,
        maxBuffer: OUTPUT_MAX_BYTES,
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      },
    );
  } catch (error) {
    // ffmpeg says why on stderr; its own words beat anything paraphrased here.
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr: unknown }).stderr).trim()
        : "";
    return {
      ok: false,
      message: stderr.length > 0 ? stderr : String(error),
    };
  }
  try {
    await access(args.output, constants.R_OK);
    const written = await stat(args.output);
    if (written.size === 0) {
      return { ok: false, message: "ffmpeg wrote an empty file." };
    }
    return { ok: true, byteLength: written.size };
  } catch {
    return { ok: false, message: "ffmpeg wrote no file." };
  }
}

export type FfmpegInstallOutcome =
  | { ok: true; output: string }
  | { ok: false; message: string };

/**
 * Install ffmpeg with Homebrew, on request and never otherwise.
 *
 * This is the one command in this plugin that changes the machine it runs on,
 * which is why it is a command of its own rather than a flag that fires when an
 * encode misses. It also installs onto the *server's* machine — the same one
 * the frames are written to — and on a remote server that is not the terminal
 * the user is sitting at.
 */
export async function installFfmpegWithBrew(args: {
  brew: string;
  signal?: AbortSignal;
}): Promise<FfmpegInstallOutcome> {
  try {
    const { stdout, stderr } = await execFileAsync(
      args.brew,
      ["install", "ffmpeg"],
      {
        timeout: FFMPEG_INSTALL_TIMEOUT_MS,
        maxBuffer: OUTPUT_MAX_BYTES,
        ...(args.signal === undefined ? {} : { signal: args.signal }),
      },
    );
    return { ok: true, output: `${stdout}${stderr}`.trim() };
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr: unknown }).stderr).trim()
        : "";
    return { ok: false, message: stderr.length > 0 ? stderr : String(error) };
  }
}

/** What to say when there is no encoder, wherever the miss happened. */
export const NO_FFMPEG_MESSAGE =
  "No ffmpeg found. Run `patcher browser install-ffmpeg`, or install it yourself (`brew install ffmpeg`), or point PATCHER_FFMPEG at one.";
