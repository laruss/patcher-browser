import {
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installCliCommand,
  readCliCommandStatus,
  type CliCommandOptions,
} from "./install-cli-command.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "patcher-cli-command-"));
  tempDirs.push(dir);
  return dir;
}

interface Host {
  dataDir: string;
  homeDir: string;
  localBin: string;
  userBin: string;
  shimPath: string;
}

/** A home with this install's shim already written, the way a live daemon leaves it. */
async function makeHost(options: { withShim?: boolean } = {}): Promise<Host> {
  const homeDir = await makeTempDir();
  const dataDir = path.join(homeDir, ".patcher");
  const shimPath = path.join(dataDir, "bin", "patcher");
  if (options.withShim ?? true) {
    await mkdir(path.dirname(shimPath), { recursive: true });
    await writeFile(shimPath, '#!/bin/sh\nexec /real/patcher "$@"\n', {
      mode: 0o755,
    });
  }
  return {
    dataDir,
    homeDir,
    localBin: path.join(homeDir, ".local", "bin"),
    shimPath,
    userBin: path.join(homeDir, "bin"),
  };
}

function options(
  host: Host,
  pathEntries: readonly string[],
): CliCommandOptions {
  return {
    dataDir: host.dataDir,
    homeDir: host.homeDir,
    platform: "darwin",
    userShellPath: pathEntries.join(":"),
  };
}

async function exists(entryPath: string): Promise<boolean> {
  return readlink(entryPath)
    .then(() => true)
    .catch(() =>
      readFile(entryPath)
        .then(() => true)
        .catch(() => false),
    );
}

describe("the `patcher` command on PATH", () => {
  it("prefers ~/.local/bin when PATH names both", async () => {
    const host = await makeHost();
    const result = await installCliCommand(
      options(host, ["/usr/bin", host.userBin, host.localBin]),
    );

    expect(result.state).toBe("installed");
    expect(result.changed).toBe(true);
    expect(result.linkPath).toBe(path.join(host.localBin, "patcher"));
    await expect(readlink(result.linkPath ?? "")).resolves.toBe(host.shimPath);
    // The directory it did not choose is left without one.
    expect(await exists(path.join(host.userBin, "patcher"))).toBe(false);
  });

  it("uses ~/bin when that is the only one on PATH", async () => {
    const host = await makeHost();
    const result = await installCliCommand(
      options(host, ["/usr/bin", host.userBin]),
    );

    expect(result.state).toBe("installed");
    expect(result.linkPath).toBe(path.join(host.userBin, "patcher"));
  });

  it("creates a directory PATH names but nobody made", async () => {
    const host = await makeHost();
    // Neither candidate exists yet; a shell skips a missing PATH entry and
    // starts reading it the moment it is there.
    const result = await installCliCommand(options(host, [host.localBin]));

    expect(result.state).toBe("installed");
    await expect(readlink(path.join(host.localBin, "patcher"))).resolves.toBe(
      host.shimPath,
    );
  });

  it("writes nothing when neither directory is on PATH", async () => {
    const host = await makeHost();
    const result = await installCliCommand(options(host, ["/usr/bin", "/bin"]));

    expect(result.state).toBe("not_on_path");
    expect(result.linkPath).toBeNull();
    // The line to add is composed from this, so it has to be the real one.
    expect(result.shimDirectory).toBe(path.join(host.dataDir, "bin"));
    expect(await exists(path.join(host.localBin, "patcher"))).toBe(false);
    expect(await exists(path.join(host.userBin, "patcher"))).toBe(false);
  });

  it("leaves a file somebody else put there", async () => {
    const host = await makeHost();
    await mkdir(host.localBin, { recursive: true });
    const occupiedPath = path.join(host.localBin, "patcher");
    await writeFile(occupiedPath, "#!/bin/sh\necho not ours\n");

    const result = await installCliCommand(options(host, [host.localBin]));

    expect(result.state).toBe("occupied");
    expect(result.existingPath).toBe(occupiedPath);
    await expect(readFile(occupiedPath, "utf8")).resolves.toBe(
      "#!/bin/sh\necho not ours\n",
    );
  });

  it("leaves a working link into somewhere else", async () => {
    const host = await makeHost();
    await mkdir(host.localBin, { recursive: true });
    const other = path.join(host.homeDir, "other-patcher");
    await writeFile(other, "#!/bin/sh\n");
    const linkPath = path.join(host.localBin, "patcher");
    await symlink(other, linkPath);

    const result = await installCliCommand(options(host, [host.localBin]));

    expect(result.state).toBe("occupied");
    expect(result.existingTarget).toBe(other);
    await expect(readlink(linkPath)).resolves.toBe(other);
  });

  it("reports its own link as installed without rewriting it", async () => {
    const host = await makeHost();
    await mkdir(host.localBin, { recursive: true });
    await symlink(host.shimPath, path.join(host.localBin, "patcher"));

    const result = await installCliCommand(options(host, [host.localBin]));

    expect(result.state).toBe("installed");
    expect(result.changed).toBe(false);
  });

  it("replaces a dangling link of this product's own shape", async () => {
    const host = await makeHost();
    await mkdir(host.localBin, { recursive: true });
    const linkPath = path.join(host.localBin, "patcher");
    // What this feature itself leaves behind when a checkout is deleted.
    await symlink(
      path.join(host.homeDir, ".patcher-dev", "gone", "bin", "patcher"),
      linkPath,
    );

    const result = await installCliCommand(options(host, [host.localBin]));

    expect(result.state).toBe("installed");
    expect(result.changed).toBe(true);
    await expect(readlink(linkPath)).resolves.toBe(host.shimPath);
  });

  it("leaves a dangling link that is not this product's", async () => {
    const host = await makeHost();
    await mkdir(host.localBin, { recursive: true });
    const linkPath = path.join(host.localBin, "patcher");
    await symlink("/nowhere/patcher", linkPath);

    const result = await installCliCommand(options(host, [host.localBin]));

    expect(result.state).toBe("occupied");
    await expect(readlink(linkPath)).resolves.toBe("/nowhere/patcher");
  });

  it("reports a `patcher` that wins the lookup from an earlier entry", async () => {
    const host = await makeHost();
    const earlier = path.join(host.homeDir, "earlier-bin");
    await mkdir(earlier, { recursive: true });
    const winner = path.join(earlier, "patcher");
    await writeFile(winner, "#!/bin/sh\n", { mode: 0o755 });

    const result = await installCliCommand(
      options(host, [earlier, host.localBin]),
    );

    // Placing a link here would change nothing a shell does, so it is not
    // placed and the state says which `patcher` answers instead.
    expect(result.state).toBe("shadowed");
    expect(result.existingPath).toBe(winner);
    expect(await exists(path.join(host.localBin, "patcher"))).toBe(false);
  });

  it("calls it installed when the winner is this install's own shim", async () => {
    const host = await makeHost();
    const result = await installCliCommand(
      options(host, [path.join(host.dataDir, "bin"), host.localBin]),
    );

    // The person put `<dataDir>/bin` on PATH themselves; `patcher` already runs.
    expect(result.state).toBe("installed");
    expect(result.changed).toBe(false);
    expect(await exists(path.join(host.localBin, "patcher"))).toBe(false);
  });

  it("refuses to point at a shim that is not there", async () => {
    const host = await makeHost({ withShim: false });
    const result = await installCliCommand(options(host, [host.localBin]));

    expect(result.state).toBe("failed");
    expect(result.message).toContain(host.shimPath);
    expect(await exists(path.join(host.localBin, "patcher"))).toBe(false);
  });

  it("claims nothing on Windows", async () => {
    const host = await makeHost();
    const result = await installCliCommand({
      ...options(host, [host.localBin]),
      platform: "win32",
    });

    expect(result.state).toBe("unsupported");
    expect(result.reason).toBe("windows");
    expect(await exists(path.join(host.localBin, "patcher"))).toBe(false);
  });

  it("claims nothing when the login shell's PATH could not be read", async () => {
    const host = await makeHost();
    const result = await installCliCommand({
      ...options(host, [host.localBin]),
      userShellPath: null,
    });

    // Answering out of the daemon's own environment — launchd's, not a
    // shell's — would report a measurement nobody made.
    expect(result.state).toBe("unknown");
    expect(await exists(path.join(host.localBin, "patcher"))).toBe(false);
  });

  it("places the link past an earlier patcher a shell would not run", async () => {
    const host = await makeHost();
    const earlier = path.join(host.homeDir, "earlier-bin");
    await mkdir(path.join(earlier, "patcher"), { recursive: true });

    const result = await installCliCommand(
      options(host, [earlier, host.localBin]),
    );

    // A directory named `patcher` is skipped by the lookup, so it wins nothing
    // and must not refuse the install.
    expect(result.state).toBe("installed");
    await expect(readlink(path.join(host.localBin, "patcher"))).resolves.toBe(
      host.shimPath,
    );
  });

  it("places the link past an earlier patcher with no execute bit", async () => {
    const host = await makeHost();
    const earlier = path.join(host.homeDir, "earlier-bin");
    await mkdir(earlier, { recursive: true });
    await writeFile(path.join(earlier, "patcher"), "not executable\n", {
      mode: 0o644,
    });

    const result = await installCliCommand(
      options(host, [earlier, host.localBin]),
    );

    expect(result.state).toBe("installed");
  });

  it("places the link past an earlier patcher that is a dead link", async () => {
    const host = await makeHost();
    const earlier = path.join(host.homeDir, "earlier-bin");
    await mkdir(earlier, { recursive: true });
    await symlink("/nowhere/patcher", path.join(earlier, "patcher"));

    const result = await installCliCommand(
      options(host, [earlier, host.localBin]),
    );

    expect(result.state).toBe("installed");
  });

  it("does not call its own link installed while the shim is missing", async () => {
    const host = await makeHost({ withShim: false });
    await mkdir(host.localBin, { recursive: true });
    await symlink(host.shimPath, path.join(host.localBin, "patcher"));

    const result = await readCliCommandStatus(options(host, [host.localBin]));

    // `patcher` would be found and then fail, which is worse than not being
    // found at all — so the row must not say it runs.
    expect(result.state).toBe("failed");
    expect(result.message).toContain(host.shimPath);
  });

  it("says the command already runs when its own shim directory is on PATH", async () => {
    const host = await makeHost();

    // The documented fallback, followed by hand: neither candidate directory
    // is on PATH, and `patcher` works anyway.
    const result = await installCliCommand(
      options(host, ["/usr/bin", path.join(host.dataDir, "bin")]),
    );

    expect(result.state).toBe("installed");
    expect(result.changed).toBe(false);
    expect(result.existingPath).toBe(host.shimPath);
    expect(await exists(path.join(host.localBin, "patcher"))).toBe(false);
  });

  it("reads without writing", async () => {
    const host = await makeHost();
    const result = await readCliCommandStatus(options(host, [host.localBin]));

    expect(result.state).toBe("missing");
    expect(result.changed).toBe(false);
    expect(await exists(path.join(host.localBin, "patcher"))).toBe(false);
  });

  it("says what Install would replace, without calling a dead link installed", async () => {
    const host = await makeHost();
    await mkdir(host.localBin, { recursive: true });
    const linkPath = path.join(host.localBin, "patcher");
    await symlink(
      path.join(host.homeDir, ".patcher-dev", "gone", "bin", "patcher"),
      linkPath,
    );

    const result = await readCliCommandStatus(options(host, [host.localBin]));

    expect(result.state).toBe("missing");
    expect(result.existingPath).toBe(linkPath);
    expect(result.existingTarget).toContain(".patcher-dev");
  });
});
