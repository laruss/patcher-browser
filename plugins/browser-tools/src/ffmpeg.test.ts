import { describe, expect, it } from "vitest";
import {
  brewCandidates,
  ffmpegCandidates,
  ffmpegEncodeArgs,
  probeBinaries,
} from "./ffmpeg.js";

describe("finding an encoder", () => {
  it("looks past PATH, because a GUI-started server has almost none", () => {
    // The trap this list exists for: a server launched from Finder inherits
    // /usr/bin:/bin and nothing else, so Homebrew's ffmpeg is invisible to a
    // bare `ffmpeg` even on a machine that plainly has one.
    expect(ffmpegCandidates({})).toEqual([
      "ffmpeg",
      "/opt/homebrew/bin/ffmpeg",
      "/usr/local/bin/ffmpeg",
    ]);
    expect(brewCandidates({})).toEqual([
      "brew",
      "/opt/homebrew/bin/brew",
      "/usr/local/bin/brew",
    ]);
  });

  it("puts an explicit override first", () => {
    expect(ffmpegCandidates({ PATCHER_FFMPEG: "/opt/custom/ffmpeg" })[0]).toBe(
      "/opt/custom/ffmpeg",
    );
  });

  it("ignores a relative override rather than resolving it", () => {
    // Against the server's cwd, which has nothing to do with the caller's — the
    // same rule every other Patcher path override follows.
    expect(ffmpegCandidates({ PATCHER_FFMPEG: "./ffmpeg" })).toEqual(
      ffmpegCandidates({}),
    );
  });

  it("takes the first candidate that actually runs, not the first that exists", () => {
    // `/etc/hosts` exists and is not an executable, which is the case a
    // file-existence check would get wrong.
    return expect(
      probeBinaries(["/nonexistent/ffmpeg", "/etc/hosts", "/bin/echo"]),
    ).resolves.toBe("/bin/echo");
  });

  it("answers null when nothing answers", () => {
    return expect(
      probeBinaries(["/nonexistent/ffmpeg", "/nonexistent/also"]),
    ).resolves.toBeNull();
  });
});

describe("the encode command", () => {
  const args = ffmpegEncodeArgs("/tmp/film/frames.txt", "/tmp/film/video.mp4");

  it("reads the playlist, so the frames keep their own timings", () => {
    expect(args).toContain("concat");
    expect(args[args.indexOf("-i") + 1]).toBe("/tmp/film/frames.txt");
    expect(args.at(-1)).toBe("/tmp/film/video.mp4");
  });

  it("rounds the frame size down to even, which H.264 requires", () => {
    // Chromium scales a screencast frame to fit the cap keeping the aspect
    // ratio, so an odd height is the normal case rather than the odd one — and
    // yuv420p refuses it. Without this the encode fails on real recordings.
    expect(args[args.indexOf("-vf") + 1]).toBe(
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    );
    expect(args).toContain("yuv420p");
  });

  it("overwrites, since a second stop into the same directory is normal", () => {
    expect(args).toContain("-y");
  });
});
