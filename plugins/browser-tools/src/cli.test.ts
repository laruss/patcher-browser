import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  pluginPermissionsFromManifest,
} from "@patcher/plugin-sdk/testing";
import plugin from "./server.js";

/**
 * `patcher browser …` exists to make the bridge observable without running an agent,
 * so what matters here is that it reaches the same API and reports the same
 * refusals — a debugging tool that lies about the state of the bridge is worse
 * than none.
 */

function createHost() {
  const host = createFakePluginHost({
    permissions: pluginPermissionsFromManifest(import.meta.url),
    pluginId: "browser-tools",
  });
  plugin(host.patcher);
  host.harness.behavior.browser.setTabs([
    { tabId: "tab-1", url: "https://example.com/", title: "Example" },
    { tabId: "tab-2", url: "https://other.test/", title: "Other", live: false },
  ]);
  host.harness.behavior.browser.setPageContent("tab-1", {
    text: "The page text.",
    selection: "page",
  });
  return host;
}

describe("patcher browser CLI", () => {
  it("registers under a name the Patcher CLI allows", () => {
    const host = createHost();
    const cli = host.harness.inspection.registrations.cli;

    expect(cli?.name).toBe("browser");
    // Subcommand metadata is rendered in help without executing plugin code,
    // so it has to list what run() actually accepts.
    const names = (cli?.commands ?? []).map((command) => command.name);
    expect(names).toContain("tabs");
    expect(names).toContain("text");
    expect(names).toContain("status");
  });

  it("prints usage instead of guessing when told nothing", async () => {
    const host = createHost();

    const result = await host.harness.runCli([]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("Usage: patcher browser");
  });

  it("lists tabs, marking the active one and the cold ones", async () => {
    const host = createHost();

    const result = await host.harness.runCli(["tabs"]);

    expect(result.exitCode).toBe(0);
    // A cold tab cannot be read or stepped through history, so it is the one
    // distinction the default output has to make visible.
    expect(result.stdout).toContain("tab-1");
    expect(result.stdout).toContain("live");
    expect(result.stdout).toContain("cold");
  });

  it("emits machine-readable output on request", async () => {
    const host = createHost();

    const result = await host.harness.runCli(["tabs", "--json"]);

    const parsed = JSON.parse(result.stdout) as Array<{ tabId: string }>;
    expect(parsed.map((tab) => tab.tabId)).toEqual(["tab-1", "tab-2"]);
  });

  it("drives the same browser API the agent tools use", async () => {
    const host = createHost();

    await host.harness.runCli(["open", "https://example.com/next"]);
    await host.harness.runCli(["open", "https://fresh.test/", "--new-tab"]);
    await host.harness.runCli(["activate", "tab-2"]);
    await host.harness.runCli(["reload", "--tab", "tab-1"]);

    expect(
      host.harness.inspection.browserCalls.map((call) => call.type),
    ).toEqual([
      "navigation.open",
      "tabs.open",
      "tabs.activate",
      "navigation.reload",
    ]);
  });

  it("reads page text and reports a truncation on stderr", async () => {
    const host = createHost();

    const full = await host.harness.runCli(["text", "--tab", "tab-1"]);
    expect(full.stdout).toContain("The page text.");
    expect(full.stderr ?? "").not.toContain("truncated");

    const clipped = await host.harness.runCli([
      "text",
      "--tab",
      "tab-1",
      "--max",
      "3",
    ]);
    // stdout stays the content alone, so it can be piped.
    expect(clipped.stdout).toBe("The\n");
    expect(clipped.stderr).toContain("truncated");
  });

  it("targets a tab explicitly with --tab", async () => {
    const host = createHost();

    const result = await host.harness.runCli(["url", "--tab", "tab-2"]);

    expect(result.stdout.trim()).toBe("https://other.test/");
  });

  it("answers a dialog and exits non-zero when there was none", async () => {
    const host = createHost();
    host.harness.behavior.browser.setPendingDialog(true);

    const answered = await host.harness.runCli(["dialog", "dismiss"]);
    expect(answered.exitCode).toBe(0);
    expect(answered.stdout).toContain("dismissed");

    const none = await host.harness.runCli(["dialog", "accept"]);
    expect(none.exitCode).toBe(1);
    expect(none.stdout).toContain("No dialog was waiting");

    const bad = await host.harness.runCli(["dialog", "maybe"]);
    expect(bad.exitCode).toBe(2);
    expect(bad.stderr).toContain("accept|dismiss");
  });

  it("reports the bridge's own state without touching a page", async () => {
    const host = createHost();

    const connected = await host.harness.runCli(["status"]);
    expect(connected.exitCode).toBe(0);
    expect(connected.stdout).toContain("Connected");

    host.harness.behavior.browser.setConnected(false);
    const offline = await host.harness.runCli(["status"]);
    // Non-zero so a script can gate on it.
    expect(offline.exitCode).toBe(1);
    expect(offline.stdout).toContain("No browser window is connected");
  });

  it("explains a failure the same way the agent tools do", async () => {
    const host = createHost();

    const cold = await host.harness.runCli(["text", "--tab", "tab-2"]);
    expect(cold.exitCode).toBe(1);
    expect(cold.stderr).toContain("Activate it");

    host.harness.behavior.browser.setConnected(false);
    const offline = await host.harness.runCli(["tabs"]);
    expect(offline.exitCode).toBe(1);
    expect(offline.stderr).toContain("open the Patcher desktop app");
  });

  it("rejects unknown commands and options rather than doing something else", async () => {
    const host = createHost();

    const unknownCommand = await host.harness.runCli(["levitate"]);
    expect(unknownCommand.exitCode).toBe(2);
    expect(unknownCommand.stderr).toContain('Unknown command "levitate"');

    const unknownOption = await host.harness.runCli(["tabs", "--all"]);
    expect(unknownOption.exitCode).toBe(2);
    expect(unknownOption.stderr).toContain("unknown option --all");

    const missingValue = await host.harness.runCli(["text", "--max"]);
    expect(missingValue.exitCode).toBe(2);
    expect(missingValue.stderr).toContain("positive integer");

    const missingUrl = await host.harness.runCli(["open"]);
    expect(missingUrl.exitCode).toBe(2);
    expect(missingUrl.stderr).toContain("URL is required");
  });
});

describe("patcher browser CLI interaction", () => {
  function interactionHost() {
    const host = createHost();
    host.harness.behavior.browser.setPageContent("tab-1", {
      snapshot: '- button "Save" [ref=e1]\n- textbox "Name" [ref=e2]',
    });
    return host;
  }

  it("lists the acting commands in help", async () => {
    const host = interactionHost();

    const result = await host.harness.runCli(["help"]);

    expect(result.exitCode).toBe(0);
    for (const command of ["click", "fill", "press", "select", "upload"]) {
      expect(result.stdout).toContain(command);
    }
  });

  it("builds each action from its positionals", async () => {
    const host = interactionHost();

    await host.harness.runCli(["click", "e1", "--tab", "tab-1"]);
    await host.harness.runCli(["hover", "e1", "--tab", "tab-1"]);
    await host.harness.runCli([
      "fill",
      "e2",
      "Ada",
      "Lovelace",
      "--tab",
      "tab-1",
    ]);
    await host.harness.runCli(["press", "Enter", "e2", "--tab", "tab-1"]);
    await host.harness.runCli(["uncheck", "e1", "--tab", "tab-1"]);

    expect(
      host.harness.inspection.browserCalls
        .filter((call) => call.type === "page.act")
        .map((call) => call.args.action),
    ).toEqual([
      {
        action: "click",
        ref: "e1",
        button: "left",
        clickCount: 1,
        modifiers: [],
      },
      { action: "hover", ref: "e1" },
      // Everything after the ref is the text, so unquoted words still work.
      { action: "fill", ref: "e2", text: "Ada Lovelace" },
      { action: "press", key: "Enter", ref: "e2" },
      { action: "check", ref: "e1", checked: false },
    ]);
  });

  it("carries the click options through", async () => {
    const host = interactionHost();

    await host.harness.runCli([
      "click",
      "e1",
      "--tab",
      "tab-1",
      "--double",
      "--button",
      "right",
      "--modifier",
      "Shift",
      "--modifier",
      "Meta",
      "--generation",
      "2",
    ]);

    const call = host.harness.inspection.browserCalls.at(-1);
    expect(call?.args.generation).toBe(2);
    expect(call?.args.action).toEqual({
      action: "click",
      ref: "e1",
      button: "right",
      clickCount: 2,
      modifiers: ["Shift", "Meta"],
    });
  });

  it("takes the rest of the line as values or paths", async () => {
    const host = interactionHost();

    await host.harness.runCli([
      "select",
      "e1",
      "Red",
      "Blue",
      "--tab",
      "tab-1",
    ]);
    await host.harness.runCli(["upload", "e1", "/tmp/a.png", "--tab", "tab-1"]);
    await host.harness.runCli(["drag", "e1", "e2", "--tab", "tab-1"]);

    expect(
      host.harness.inspection.browserCalls
        .filter((call) => call.type === "page.act")
        .map((call) => call.args.action),
    ).toEqual([
      { action: "select", ref: "e1", values: ["Red", "Blue"] },
      { action: "upload", ref: "e1", paths: ["/tmp/a.png"] },
      { action: "drag", ref: "e1", targetRef: "e2" },
    ]);
  });

  it("resizes, and resets with a word rather than two zeroes", async () => {
    const host = interactionHost();

    await host.harness.runCli(["resize", "1280", "720", "--tab", "tab-1"]);
    await host.harness.runCli(["resize", "reset", "--tab", "tab-1"]);

    expect(
      host.harness.inspection.browserCalls
        .filter((call) => call.type === "page.act")
        .map((call) => call.args.action),
    ).toEqual([
      { action: "resize", width: 1280, height: 720 },
      { action: "resize", width: 0, height: 0 },
    ]);
  });

  it("prints the snapshot generation where it will not pollute a pipe", async () => {
    const host = interactionHost();

    const result = await host.harness.runCli(["snapshot", "--tab", "tab-1"]);

    // stdout stays the tree alone; the number the acting commands want back
    // goes to stderr.
    expect(result.stdout).not.toContain("generation");
    expect(result.stderr).toContain("generation");
  });

  it("passes a selector through to the snapshot it scopes", async () => {
    const host = interactionHost();

    await host.harness.runCli([
      "snapshot",
      "--tab",
      "tab-1",
      "--selector",
      "form.checkout",
    ]);

    expect(
      host.harness.inspection.browserCalls
        .filter((call) => call.type === "page.snapshot")
        .map((call) => call.args.selector),
    ).toEqual(["form.checkout"]);
  });

  it("refuses a selector flag with nothing after it", async () => {
    const host = interactionHost();

    await expect(
      host.harness.runCli(["snapshot", "--selector"]),
    ).resolves.toMatchObject({ exitCode: 2 });
  });

  it("refuses an incomplete command instead of acting on a default", async () => {
    const host = interactionHost();

    for (const argv of [
      ["click"],
      ["drag", "e1"],
      ["select", "e1"],
      ["upload", "e1"],
      ["press"],
      ["resize", "wide"],
    ]) {
      const result = await host.harness.runCli(argv);
      expect(result.exitCode, argv.join(" ")).toBe(2);
    }
    expect(
      host.harness.inspection.browserCalls.filter(
        (call) => call.type === "page.act",
      ),
    ).toEqual([]);
  });

  it("rejects an option value it does not recognize", async () => {
    const host = interactionHost();

    const badButton = await host.harness.runCli([
      "click",
      "e1",
      "--button",
      "up",
    ]);
    expect(badButton.exitCode).toBe(2);
    expect(badButton.stderr).toContain("left, middle or right");

    const badModifier = await host.harness.runCli([
      "click",
      "e1",
      "--modifier",
      "Hyper",
    ]);
    expect(badModifier.exitCode).toBe(2);

    const badGeneration = await host.harness.runCli([
      "click",
      "e1",
      "--generation",
      "-1",
    ]);
    expect(badGeneration.exitCode).toBe(2);
  });

  it("explains a stale ref the same way the tools do", async () => {
    const host = interactionHost();
    host.harness.behavior.browser.failNextCall("stale_refs");

    const result = await host.harness.runCli(["click", "e1", "--tab", "tab-1"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("fresh snapshot");
  });
});

describe("patcher browser observation commands", () => {
  function observationHost() {
    const host = createHost();
    host.harness.behavior.browser.setPageContent("tab-1", {
      console: [
        {
          level: "error",
          text: "Uncaught TypeError",
          source: "https://example.com/app.js",
          line: 12,
          timestamp: 1,
        },
        { level: "info", text: "ready", source: "", line: 0, timestamp: 2 },
      ],
      network: [
        {
          method: "GET",
          url: "https://example.com/app.js",
          resourceType: "script",
          status: 200,
          fromCache: true,
          error: null,
          timestamp: 1,
        },
        {
          method: "GET",
          url: "http://127.0.0.1:9/",
          resourceType: "xhr",
          status: null,
          fromCache: false,
          error: "net::ERR_BLOCKED_BY_CLIENT",
          timestamp: 2,
        },
      ],
    });
    return host;
  }

  it("writes a screenshot to the path it was given, relative to the caller's cwd", async () => {
    const host = observationHost();
    const directory = await mkdtemp(join(tmpdir(), "patcher-browser-cli-"));

    const result = await host.harness.runCli(
      ["screenshot", "shot.png", "--tab", "tab-1"],
      { cwd: directory },
    );

    expect(result.exitCode).toBe(0);
    // Resolved against the shell that ran `patcher`, not the server process this
    // handler happens to execute in.
    const written = await readFile(join(directory, "shot.png"));
    expect(written.subarray(0, 4).toString("hex")).toBe("89504e47");
    expect(result.stdout).toContain(join(directory, "shot.png"));
    await rm(directory, { recursive: true, force: true });
  });

  it("asks for PNG when the file name says so, and JPEG otherwise", async () => {
    const host = observationHost();
    const directory = await mkdtemp(join(tmpdir(), "patcher-browser-cli-"));

    await host.harness.runCli(["screenshot", "a.png"], { cwd: directory });
    await host.harness.runCli(["screenshot", "b.jpg"], { cwd: directory });

    expect(
      host.harness.inspection.browserCalls
        .filter((call) => call.type === "page.screenshot")
        .map((call) => call.args.format),
    ).toEqual(["png", "jpeg"]);
    await rm(directory, { recursive: true, force: true });
  });

  it("captures the whole document when asked for it", async () => {
    const host = observationHost();
    const directory = await mkdtemp(join(tmpdir(), "patcher-browser-cli-"));

    await host.harness.runCli(["screenshot", "long.jpg", "--full-page"], {
      cwd: directory,
    });

    expect(
      host.harness.inspection.browserCalls
        .filter((call) => call.type === "page.screenshot")
        .map((call) => call.args.fullPage),
    ).toEqual([true]);
    await rm(directory, { recursive: true, force: true });
  });

  it("writes a PDF and refuses to guess a path", async () => {
    const host = observationHost();
    const directory = await mkdtemp(join(tmpdir(), "patcher-browser-cli-"));

    const missing = await host.harness.runCli(["pdf"], { cwd: directory });
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain("file path");

    const result = await host.harness.runCli(["pdf", "page.pdf"], {
      cwd: directory,
    });
    expect(result.exitCode).toBe(0);
    expect((await readFile(join(directory, "page.pdf"))).toString()).toContain(
      "%PDF",
    );
    await rm(directory, { recursive: true, force: true });
  });

  it("shows console errors with where they came from", async () => {
    const host = observationHost();

    const result = await host.harness.runCli(["console", "--tab", "tab-1"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("error\tUncaught TypeError");
    expect(result.stdout).toContain("https://example.com/app.js:12");
  });

  it("puts a network failure where the status would be", async () => {
    const host = observationHost();

    const result = await host.harness.runCli(["network", "--tab", "tab-1"]);

    // "Which requests went wrong" is the question this listing exists for, so
    // the error has to be in the column the eye already scans.
    expect(result.stdout).toContain("200\tGET\tscript (cache)");
    expect(result.stdout).toContain("net::ERR_BLOCKED_BY_CLIENT\tGET\txhr");
  });

  it("says on stderr how many log entries it is not showing", async () => {
    const host = observationHost();

    const result = await host.harness.runCli([
      "console",
      "--tab",
      "tab-1",
      "--max",
      "1",
    ]);

    // stdout stays a clean list to grep; the caveat rides alongside it.
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toContain("1 earlier entry not shown");
  });

  it("says plainly when a page logged nothing", async () => {
    const host = createHost();

    const result = await host.harness.runCli(["console", "--tab", "tab-1"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("logged nothing");
  });
});

describe("patcher browser storage commands", () => {
  const COOKIE = {
    name: "session",
    value: "abc123",
    domain: ".example.com",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
  };

  function storageHost() {
    const host = createHost();
    host.harness.behavior.browser.setPageContent("tab-1", {
      cookies: [COOKIE],
      localStorage: [{ name: "token", value: "xyz" }],
      sessionStorage: [{ name: "draft", value: "hello" }],
    });
    return host;
  }

  it("lists cookies with their values, because a value-less cookie is nothing", async () => {
    const host = storageHost();

    const result = await host.harness.runCli(["cookie-list", "--tab", "tab-1"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("session");
    expect(result.stdout).toContain("abc123");
    expect(result.stdout).toContain("httpOnly");
  });

  it("filters to one cookie, and refuses to guess which", async () => {
    const host = storageHost();

    await expect(host.harness.runCli(["cookie-get"])).resolves.toMatchObject({
      exitCode: 2,
    });
    const found = await host.harness.runCli([
      "cookie-get",
      "session",
      "--tab",
      "tab-1",
    ]);
    expect(found.stdout).toContain("abc123");
    const missing = await host.harness.runCli([
      "cookie-get",
      "absent",
      "--tab",
      "tab-1",
    ]);
    expect(missing.stdout).toContain("No cookies");
  });

  it("sets a cookie, taking the rest of the line as its value", async () => {
    const host = storageHost();

    const result = await host.harness.runCli([
      "cookie-set",
      "note",
      "two",
      "words",
      "--tab",
      "tab-1",
    ]);

    expect(result.exitCode).toBe(0);
    expect(
      host.harness.inspection.browserCalls.filter(
        (call) => call.type === "storage.setCookies",
      ),
    ).toHaveLength(1);
    const listed = await host.harness.runCli(["cookie-list", "--tab", "tab-1"]);
    expect(listed.stdout).toContain("two words");
  });

  it("deletes one cookie and clears the rest", async () => {
    const host = storageHost();

    const deleted = await host.harness.runCli([
      "cookie-delete",
      "session",
      "--tab",
      "tab-1",
    ]);
    expect(deleted.stdout).toContain("Removed 1 cookie");
    const cleared = await host.harness.runCli([
      "cookie-clear",
      "--tab",
      "tab-1",
    ]);
    expect(cleared.stdout).toContain("Removed 0 cookies");
  });

  it("keeps localStorage and sessionStorage apart", async () => {
    const host = storageHost();

    const local = await host.harness.runCli([
      "localstorage-list",
      "--tab",
      "tab-1",
    ]);
    const session = await host.harness.runCli([
      "sessionstorage-list",
      "--tab",
      "tab-1",
    ]);

    expect(local.stdout).toContain("token\txyz");
    expect(local.stdout).not.toContain("draft");
    expect(session.stdout).toContain("draft\thello");
    expect(
      host.harness.inspection.browserCalls
        .filter((call) => call.type === "storage.items")
        .map((call) => call.args.area),
    ).toEqual(["local", "session"]);
  });

  it("writes and removes one key at a time", async () => {
    const host = storageHost();

    await host.harness.runCli([
      "sessionstorage-set",
      "draft",
      "a longer note",
      "--tab",
      "tab-1",
    ]);
    const listed = await host.harness.runCli([
      "sessionstorage-get",
      "draft",
      "--tab",
      "tab-1",
    ]);
    expect(listed.stdout).toContain("a longer note");

    const removed = await host.harness.runCli([
      "sessionstorage-delete",
      "draft",
      "--tab",
      "tab-1",
    ]);
    expect(removed.stdout).toContain("Removed 1 item");
  });

  it("saves a session in Playwright's format, to a file or to stdout", async () => {
    const host = storageHost();
    const directory = await mkdtemp(join(tmpdir(), "patcher-browser-cli-"));

    const printed = await host.harness.runCli(
      ["state-save", "--tab", "tab-1"],
      {
        cwd: directory,
      },
    );
    expect(JSON.parse(printed.stdout)).toEqual({
      cookies: [COOKIE],
      origins: [
        {
          origin: "https://example.com",
          localStorage: [{ name: "token", value: "xyz" }],
        },
      ],
    });
    // Whoever runs this has to learn what the file is, and stderr is where a
    // caveat can go without breaking a pipe.
    expect(printed.stderr).toContain("credential");

    const saved = await host.harness.runCli(
      ["state-save", "state.json", "--tab", "tab-1"],
      { cwd: directory },
    );
    expect(saved.exitCode).toBe(0);
    expect(
      JSON.parse(await readFile(join(directory, "state.json"), "utf8")).cookies,
    ).toEqual([COOKIE]);
    await rm(directory, { recursive: true, force: true });
  });

  it("loads a saved session and says what it could not place", async () => {
    const host = storageHost();
    const directory = await mkdtemp(join(tmpdir(), "patcher-browser-cli-"));
    await writeFile(
      join(directory, "state.json"),
      JSON.stringify({
        cookies: [{ ...COOKIE, name: "restored" }],
        origins: [
          {
            origin: "https://example.com",
            localStorage: [{ name: "token", value: "restored" }],
          },
          {
            origin: "https://sso.test",
            localStorage: [{ name: "token", value: "elsewhere" }],
          },
        ],
      }),
      "utf8",
    );

    const result = await host.harness.runCli(
      ["state-load", "state.json", "--tab", "tab-1"],
      { cwd: directory },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1 cookies applied");
    expect(result.stdout).toContain("1 localStorage items applied");
    // The other origin's storage cannot be written without navigating the
    // user's browser to it, so it is reported rather than silently dropped.
    expect(result.stderr).toContain("1 other origin");
    const listed = await host.harness.runCli([
      "localstorage-get",
      "token",
      "--tab",
      "tab-1",
    ]);
    expect(listed.stdout).toContain("restored");
    await rm(directory, { recursive: true, force: true });
  });

  it("refuses a file that is not a saved session", async () => {
    const host = storageHost();
    const directory = await mkdtemp(join(tmpdir(), "patcher-browser-cli-"));
    await writeFile(join(directory, "notes.json"), "not json at all", "utf8");

    const result = await host.harness.runCli(
      ["state-load", "notes.json", "--tab", "tab-1"],
      { cwd: directory },
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("not a storage state file");
    await rm(directory, { recursive: true, force: true });
  });
});

describe("patcher browser direct control commands", () => {
  it("sends the function as given and prints what came back", async () => {
    const host = createHost();
    host.harness.behavior.browser.setPageContent("tab-1", {
      evaluated: '{"count":3}',
    });

    const result = await host.harness.runCli([
      "eval",
      "() => ({ count: document.links.length })",
      "--tab",
      "tab-1",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('{"count":3}\n');
    expect(host.harness.inspection.browserCalls).toContainEqual({
      type: "control.evaluate",
      args: {
        expression: "() => ({ count: document.links.length })",
        ref: undefined,
        tabId: "tab-1",
        generation: undefined,
      },
    });
  });

  it("takes a ref as the second positional, the way Playwright's eval does", async () => {
    const host = createHost();

    await host.harness.runCli([
      "eval",
      "(el) => el.value",
      "e4",
      "--tab",
      "tab-1",
    ]);

    expect(host.harness.inspection.browserCalls.at(-1)).toMatchObject({
      type: "control.evaluate",
      args: { expression: "(el) => el.value", ref: "e4" },
    });
  });

  it("refuses to evaluate nothing", async () => {
    const host = createHost();

    await expect(host.harness.runCli(["eval"])).resolves.toMatchObject({
      exitCode: 2,
    });
  });

  it("moves, presses and scrolls at coordinates", async () => {
    const host = createHost();

    for (const argv of [
      ["mousemove", "120", "64"],
      ["mousedown", "right"],
      ["mouseup"],
      ["mousewheel", "0", "-240"],
    ]) {
      await expect(
        host.harness.runCli([...argv, "--tab", "tab-1"]),
      ).resolves.toMatchObject({ exitCode: 0 });
    }

    expect(
      host.harness.inspection.browserCalls
        .filter((call) => call.type.startsWith("control.mouse"))
        .map((call) => [call.type, call.args]),
    ).toEqual([
      ["control.mouseMove", { x: 120, y: 64, tabId: "tab-1" }],
      ["control.mouseButton", { down: true, button: "right", tabId: "tab-1" }],
      ["control.mouseButton", { down: false, button: "left", tabId: "tab-1" }],
      ["control.mouseWheel", { deltaX: 0, deltaY: -240, tabId: "tab-1" }],
    ]);
  });

  it("refuses a coordinate command with nothing to act on", async () => {
    const host = createHost();

    await expect(
      host.harness.runCli(["mousemove", "120"]),
    ).resolves.toMatchObject({
      exitCode: 2,
    });
    await expect(
      host.harness.runCli(["mousedown", "sideways"]),
    ).resolves.toMatchObject({ exitCode: 2 });
  });

  it("mocks a response, lists it with its hit count, and removes it", async () => {
    const host = createHost();

    const added = await host.harness.runCli([
      "route",
      "**/api/me",
      "--status",
      "201",
      "--body",
      '{"ok":true}',
      "--header",
      "x-mock: 1",
      "--tab",
      "tab-1",
    ]);

    expect(added.exitCode).toBe(0);
    expect(added.stdout).toContain("**/api/me");
    // The hit count is the column that answers "did my mock fire".
    expect(added.stdout).toContain("0\t201");
    expect(host.harness.inspection.browserCalls.at(-1)).toMatchObject({
      type: "control.route",
      args: {
        pattern: "**/api/me",
        status: 201,
        body: '{"ok":true}',
        headers: [{ name: "x-mock", value: "1" }],
      },
    });

    const listed = await host.harness.runCli(["route-list", "--tab", "tab-1"]);
    expect(listed.stdout).toContain("**/api/me");

    const removed = await host.harness.runCli(["unroute", "--tab", "tab-1"]);
    expect(removed.stdout).toContain("That tab mocks nothing.");
  });

  it("refuses a route with no pattern and a header with no value", async () => {
    const host = createHost();

    await expect(host.harness.runCli(["route"])).resolves.toMatchObject({
      exitCode: 2,
    });
    await expect(
      host.harness.runCli(["route", "**", "--header", "x-mock"]),
    ).resolves.toMatchObject({ exitCode: 2 });
    await expect(
      host.harness.runCli(["route", "**", "--status", "twelve"]),
    ).resolves.toMatchObject({ exitCode: 2 });
  });

  it("takes a tab offline and says so where the routes are listed", async () => {
    const host = createHost();

    const offline = await host.harness.runCli([
      "network-state-set",
      "offline",
      "--tab",
      "tab-1",
    ]);

    expect(offline.exitCode).toBe(0);
    expect(offline.stdout).toContain("offline");
    const listed = await host.harness.runCli(["route-list", "--tab", "tab-1"]);
    // Not a route, but the answer to the question someone reading an empty
    // route table is usually asking.
    expect(listed.stderr).toContain("This tab is offline.");
  });

  it("refuses a network state that is neither", async () => {
    const host = createHost();

    await expect(
      host.harness.runCli(["network-state-set", "flaky"]),
    ).resolves.toMatchObject({ exitCode: 2 });
  });

  it("lists the direct-control commands in help, with what they cost", async () => {
    const host = createHost();

    const result = await host.harness.runCli(["help"]);

    expect(result.stdout).toContain("Direct control");
    expect(result.stdout).toContain("skip what makes the commands above safe");
    expect(result.stdout).toContain("network-state-set");
  });
  it("writes a trace as a directory a person can open", async () => {
    const host = createHost();
    const directory = await mkdtemp(join(tmpdir(), "patcher-browser-cli-"));

    await host.harness.runCli(["tracing-start", "--screenshots"]);
    await host.harness.runCli(["tabs"]);
    const stopped = await host.harness.runCli(["tracing-stop", "trace"], {
      cwd: directory,
    });

    expect(stopped.exitCode).toBe(0);
    const written = JSON.parse(
      await readFile(join(directory, "trace", "trace.json"), "utf8"),
    ) as { steps: { command: string; image: string | null }[] };
    expect(written.steps.map((step) => step.command)).toEqual(["tabs.list"]);
    await rm(directory, { recursive: true, force: true });
  });

  it("prints a trace with the images left out when given nowhere to put them", async () => {
    const host = createHost();

    await host.harness.runCli(["tracing-start"]);
    await host.harness.runCli(["tabs"]);
    const stopped = await host.harness.runCli(["tracing-stop"]);

    // Base64 in a terminal is not a thing anyone reads, and the log is.
    expect(JSON.parse(stopped.stdout)).toMatchObject({
      steps: [{ command: "tabs.list", image: null }],
    });
  });

  it("refuses to stop a trace that is not running", async () => {
    const host = createHost();

    const result = await host.harness.runCli(["tracing-stop"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("trace");
  });

  it("writes the frames, their timings and an ffconcat playlist", async () => {
    const host = createHost();
    host.harness.behavior.browser.setPageContent("tab-1", {
      frames: [
        { at: 0, base64: Buffer.from("first").toString("base64") },
        { at: 400, base64: Buffer.from("second").toString("base64") },
      ],
    });
    const directory = await mkdtemp(join(tmpdir(), "patcher-browser-cli-"));

    await host.harness.runCli(["video-start", "--fps", "5", "--tab", "tab-1"]);
    await host.harness.runCli(["video-chapter", "signed in", "--tab", "tab-1"]);
    const stopped = await host.harness.runCli(
      ["video-stop", "film", "--tab", "tab-1"],
      { cwd: directory },
    );

    expect(stopped.exitCode).toBe(0);
    expect(
      await readFile(join(directory, "film", "frame-00001.jpg"), "utf8"),
    ).toBe("first");
    const playlist = await readFile(
      join(directory, "film", "frames.txt"),
      "utf8",
    );
    // The timings are the whole point of the playlist: frames arrive when the
    // page repaints, so a numbered sequence would play back at the wrong speed.
    expect(playlist).toContain("file frame-00001.jpg");
    expect(playlist).toContain("duration 0.400");
    expect(playlist.trimEnd().endsWith("file frame-00002.jpg")).toBe(true);
    const manifest = JSON.parse(
      await readFile(join(directory, "film", "video.json"), "utf8"),
    ) as { chapters: { title: string }[] };
    expect(manifest.chapters).toEqual([{ at: 0, title: "signed in" }]);
    // Frames are frames until something encodes them, and this is where saying
    // so is useful.
    expect(stopped.stderr).toContain("--encode");
    expect(stopped.stderr).toContain("-f concat");
    await rm(directory, { recursive: true, force: true });
  });

  it("encodes the frames with the ffmpeg it was pointed at", async () => {
    const host = createHost();
    host.harness.behavior.browser.setPageContent("tab-1", {
      frames: [
        { at: 0, base64: Buffer.from("first").toString("base64") },
        { at: 400, base64: Buffer.from("second").toString("base64") },
      ],
    });
    const directory = await mkdtemp(join(tmpdir(), "patcher-browser-cli-"));
    // A stand-in for ffmpeg rather than the real one: what is worth pinning is
    // the arguments Patcher passes and that it checks a file appeared, neither of
    // which needs an encoder — and a test that encodes video is a test that
    // fails on a machine without one.
    const fake = join(directory, "fake-ffmpeg");
    const argvLog = join(directory, "argv.txt");
    await writeFile(
      fake,
      [
        "#!/bin/sh",
        'if [ "$1" = "-version" ]; then echo "fake ffmpeg"; exit 0; fi',
        `printf '%s\\n' "$@" > ${argvLog}`,
        "for out; do :; done",
        'printf "fake video" > "$out"',
      ].join("\n"),
      { mode: 0o755 },
    );
    const previous = process.env.PATCHER_FFMPEG;
    process.env.PATCHER_FFMPEG = fake;
    try {
      await host.harness.runCli(["video-start", "--tab", "tab-1"]);
      const stopped = await host.harness.runCli(
        ["video-stop", "film", "--encode", "--tab", "tab-1"],
        { cwd: directory },
      );

      expect(stopped.exitCode).toBe(0);
      const argv = (await readFile(argvLog, "utf8")).trim().split("\n");
      expect(argv).toContain("concat");
      expect(argv).toContain(join(directory, "film", "frames.txt"));
      expect(argv.at(-1)).toBe(join(directory, "film", "video.mp4"));
      expect(await readFile(join(directory, "film", "video.mp4"), "utf8")).toBe(
        "fake video",
      );
      // The frames stay: they are the recording, and the video is a rendering
      // of them that anything can redo.
      expect(
        await readFile(join(directory, "film", "frame-00001.jpg"), "utf8"),
      ).toBe("first");
      expect(stopped.stdout).toContain("video.mp4");
    } finally {
      if (previous === undefined) {
        delete process.env.PATCHER_FFMPEG;
      } else {
        process.env.PATCHER_FFMPEG = previous;
      }
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the frames when the encoder fails, and says why", async () => {
    const host = createHost();
    host.harness.behavior.browser.setPageContent("tab-1", {
      frames: [{ at: 0, base64: Buffer.from("first").toString("base64") }],
    });
    const directory = await mkdtemp(join(tmpdir(), "patcher-browser-cli-"));
    const fake = join(directory, "fake-ffmpeg");
    await writeFile(
      fake,
      [
        "#!/bin/sh",
        'if [ "$1" = "-version" ]; then exit 0; fi',
        'echo "Invalid data found when processing input" >&2',
        "exit 1",
      ].join("\n"),
      { mode: 0o755 },
    );
    const previous = process.env.PATCHER_FFMPEG;
    process.env.PATCHER_FFMPEG = fake;
    try {
      await host.harness.runCli(["video-start", "--tab", "tab-1"]);
      const stopped = await host.harness.runCli(
        ["video-stop", "film", "--encode", "--tab", "tab-1"],
        { cwd: directory },
      );

      expect(stopped.exitCode).toBe(1);
      // ffmpeg's own words, and the reassurance that stops someone re-recording
      // a session they still have on disk.
      expect(stopped.stderr).toContain("Invalid data found");
      expect(stopped.stderr).toContain("frames are written");
      expect(
        await readFile(join(directory, "film", "frame-00001.jpg"), "utf8"),
      ).toBe("first");
    } finally {
      if (previous === undefined) {
        delete process.env.PATCHER_FFMPEG;
      } else {
        process.env.PATCHER_FFMPEG = previous;
      }
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("will not throw a film away for want of somewhere to put it", async () => {
    const host = createHost();

    const result = await host.harness.runCli(["video-stop"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("directory is required");
  });

  it("lists the recording commands in help", async () => {
    const host = createHost();

    const result = await host.harness.runCli(["help"]);

    expect(result.stdout).toContain("Recording");
    expect(result.stdout).toContain("tracing-start");
    expect(result.stdout).toContain("video-stop");
  });
});
