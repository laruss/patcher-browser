import { describe, expect, it } from "vitest";
import { PATCHER_APP_KEY_FILE_NAME } from "@patcher/config/app-key";
import { PATCHER_THREAD_KEY_ENV } from "@patcher/config/thread-api-key";
import { describeRefusedCredential } from "../app-credential-hint.js";

/**
 * A 401 has to name the credential and the path this process looked in.
 *
 * The path is the part that cannot be guessed and the reason this exists: a dev
 * checkout resolves a different data dir from an installed Patcher, so the same
 * command works in one shell and not the next, and the message is the only place
 * the difference is visible.
 */
describe("describeRefusedCredential", () => {
  it("names the environment variable and the file, with the path filled in", () => {
    const hint = describeRefusedCredential({
      env: { PATCHER_DATA_DIR: "/tmp/patcher-data", NODE_ENV: "production" },
      homeDir: "/Users/someone",
    });

    expect(hint).toContain("PATCHER_APP_KEY");
    expect(hint).toContain(`/tmp/patcher-data/${PATCHER_APP_KEY_FILE_NAME}`);
    // And a next step, not just a diagnosis.
    expect(hint).toContain("start Patcher");
  });

  it("falls back to the production data dir under the home it was given", () => {
    const hint = describeRefusedCredential({
      env: { NODE_ENV: "production" },
      homeDir: "/Users/someone",
    });

    expect(hint).toContain(
      `/Users/someone/.patcher/${PATCHER_APP_KEY_FILE_NAME}`,
    );
  });

  it("says the data dir cannot be named rather than printing a wrong path", () => {
    // A dev checkout with no repo root: `resolveAppApiKey` genuinely cannot name
    // a data dir here, and a plausible-looking path would send the reader to a
    // file this process never opened.
    const hint = describeRefusedCredential({
      env: {},
      homeDir: "/Users/someone",
    });

    expect(hint).toContain("cannot name the data dir");
    expect(hint).toContain("PATCHER_DATA_DIR");
  });

  it("does not tell a turn's shell to go read the app key file", () => {
    const hint = describeRefusedCredential({
      env: { [PATCHER_THREAD_KEY_ENV]: "thread-key", NODE_ENV: "production" },
      homeDir: "/Users/someone",
    });

    // An agent's shell is handed a thread-scoped credential *instead of* the app
    // key. Advising it to read the key file would undo that if followed.
    expect(hint).toContain(PATCHER_THREAD_KEY_ENV);
    expect(hint).not.toContain(PATCHER_APP_KEY_FILE_NAME);
    // And it does not claim a boundary nothing enforces: the key carries no
    // deadline, so it is not refused when the turn ends.
    expect(hint).not.toContain("turn that issued it has ended");
  });

  it("says the key was presented and refused when one is set", () => {
    const hint = describeRefusedCredential({
      env: { PATCHER_APP_KEY: "wrong", NODE_ENV: "production" },
      homeDir: "/Users/someone",
    });

    expect(hint).toContain("was presented");
    expect(hint).toContain("different install");
  });
});
