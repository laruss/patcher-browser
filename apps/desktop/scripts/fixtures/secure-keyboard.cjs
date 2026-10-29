const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  powerMonitor,
} = require("electron");
const { createServer } = require("node:http");
const { join } = require("node:path");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const root = process.env.PATCHER_SECURE_KEYBOARD_ROOT;
const dist = process.env.PATCHER_SECURE_KEYBOARD_DIST;
const { registerSecureKeyboardEntry } = require(join(root, "security.js"));
const { createDesktopBrowserViewManager, PATCHER_BROWSER_PARTITION } = require(
  join(root, "browser.js"),
);
app.setPath("userData", join(root, "profile"));
const reports = [];
const results = [];
let manager;
let server;
const deadline = setTimeout(
  () => finish(new Error("secure keyboard harness deadline exceeded")),
  45_000,
);

function execute(contents, func, ...args) {
  return contents.executeJavaScript(
    `(${func.toString()})(...${JSON.stringify(args)})`,
  );
}
async function waitFor(check, label) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
}
async function state(expected, label) {
  await waitFor(() => app.isSecureKeyboardEntryEnabled() === expected, label);
  results.push({ label, enabled: expected });
}
async function field(contents, selector) {
  await execute(
    contents,
    (selector) => document.querySelector(selector).focus(),
    selector,
  );
}
async function activate(window, contents) {
  app.show();
  app.focus({ steal: true });
  window.show();
  window.focus();
  contents.focus();
  await waitFor(() => {
    app.focus({ steal: true });
    window.focus();
    contents.focus();
    return window.isFocused() && contents.isFocused();
  }, "native focus");
}
function finish(error) {
  clearTimeout(deadline);
  manager?.destroyAll();
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.setSecureKeyboardEntryEnabled(false);
  assert.equal(app.isSecureKeyboardEntryEnabled(), false);
  server?.close();
  if (error) {
    console.error(error);
    console.error("completed checks", results.slice(-4));
  } else
    console.log(
      JSON.stringify(
        {
          electron: process.versions.electron,
          packagedPreloads: dist.includes("app.asar"),
          results,
          reportsContainValues: false,
          finalEnabled: false,
        },
        null,
        2,
      ),
    );
  app.exit(error ? 1 : 0);
}

(async () => {
  await app.whenReady();
  assert.equal(process.platform, "darwin");
  const security = registerSecureKeyboardEntry();
  ipcMain.on("patcher-desktop:secure-keyboard:focus", (_event, payload) =>
    reports.push(payload),
  );
  ipcMain.handle("patcher-desktop:get-info", () => ({
    downloadState: "idle",
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform: "macos",
    updateAvailable: false,
    updateDownloaded: false,
    version: "smoke",
  }));
  ipcMain.handle("patcher-desktop:get-window-state", () => ({
    isFullScreen: false,
  }));
  let slowRequested = false;
  server = createServer((request, response) => {
    if (request.url === "/slow") {
      slowRequested = true;
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html",
      "Content-Security-Policy": "script-src 'nonce-fixture'",
    });
    response.end(`<!doctype html>
      <input id="password" type="password"><input id="plain" type="text">
      <div id="open"></div><div id="closed"></div><iframe id="frame" src="/frame"></iframe>
      <script nonce="fixture">
        if (location.pathname !== '/frame') {
          const open = document.querySelector('#open').attachShadow({mode:'open'});
          open.innerHTML = '<input id="shadow" type="password"><input id="shadow-plain">';
          const closed = document.querySelector('#closed').attachShadow({mode:'closed'});
          closed.innerHTML = '<input type="password">';
          window.focusClosed = () => closed.querySelector('input').focus();
          window.patcherDesktop?.browser.onPopup(data => { window.lastPopup = data; });
        } else document.querySelector('iframe').remove();
      </script>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  session.fromPartition(PATCHER_BROWSER_PARTITION).registerPreloadScript({
    id: "patcher-browser-security",
    type: "frame",
    filePath: join(dist, "browser-security-preload.cjs"),
  });
  const window = new BrowserWindow({
    show: false,
    width: 900,
    height: 600,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(dist, "preload.cjs"),
    },
  });
  await window.loadURL(url);
  await activate(window, window.webContents);
  await field(window.webContents, "#password");
  await state(true, "trusted UI password (settings/auth prompt)");
  await field(window.webContents, "#plain");
  await state(false, "trusted UI ordinary field/address bar");
  const second = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(dist, "preload.cjs"),
    },
  });
  await second.loadURL(url);
  await activate(second, second.webContents);
  await field(second.webContents, "#password");
  await state(true, "second window password");
  await activate(window, window.webContents);
  await field(window.webContents, "#plain");
  await state(false, "switch back to ordinary first window");
  await field(window.webContents, "#password");
  await state(true, "first window password before background close");
  second.destroy();
  await state(
    true,
    "background window teardown preserves foreground protection",
  );
  await field(window.webContents, "#plain");
  await state(false, "leave first window password");

  manager = createDesktopBrowserViewManager({
    onBrowserViewVisibilityChanged: security.browserViewChanged,
    pageScriptPreloadPath: join(dist, "page-script-preload.cjs"),
    dispatchAppCommand() {},
    downloadPathExists: () => false,
    extractPdfText: async () => ({ ok: false, reason: "unreadable" }),
    focusHostWebContents: () => window.webContents.focus(),
    openDownloadPath: async () => "",
    openExternalUrl() {},
    revealDownloadPath() {},
    resolveDownloadDirectory: () => root,
    resolveAppCommand: () => null,
  });
  const bounds = { x: 0, y: 120, width: 800, height: 400 };
  manager.attach({
    hostWindow: window,
    request: { tabId: "secure-smoke", url, bounds, visible: true },
  });
  const view = window.contentView.children.find(
    (view) => view.webContents !== undefined,
  );
  const page = view.webContents;
  await waitFor(
    () => !page.isLoading() && page.getURL() === url,
    "browser load",
  );
  await activate(window, page);
  assert.equal(
    await execute(
      page,
      () =>
        typeof require !== "undefined" ||
        typeof process !== "undefined" ||
        typeof patcherDesktop !== "undefined",
    ),
    false,
  );
  await field(page, "#password");
  await state(true, "browser password");
  page.insertText("aЖ");
  assert.equal(
    await execute(
      page,
      () => document.querySelector("#password").value === "aЖ",
    ),
    true,
  );
  await execute(page, () => {
    const field = document.querySelector("#password");
    field.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    field.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "Ж" }),
    );
  });
  await state(true, "Unicode typing/composition events preserve protection");
  await execute(
    page,
    () => (document.querySelector("#password").type = "text"),
  );
  await state(false, "focused input type becomes text");
  await execute(
    page,
    () => (document.querySelector("#password").type = "password"),
  );
  await state(true, "focused input type becomes password");
  await field(page, "#plain");
  await state(false, "browser ordinary input");
  await execute(page, () => {
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    document.querySelector("#password").focus();
  });
  await state(true, "synthetic pagehide cannot stop password reporting");
  await field(page, "#plain");
  await state(false, "ordinary focus before synthetic pageshow");
  const documentId = reports.at(-1).documentId;
  await execute(page, () => {
    window.dispatchEvent(new PageTransitionEvent("pageshow"));
    document.querySelector("#password").focus();
  });
  await state(true, "synthetic pageshow preserves password reporting");
  await waitFor(
    () => reports.at(-1)?.protect === true,
    "password report after synthetic pageshow",
  );
  assert.equal(reports.at(-1).documentId, documentId);
  await execute(page, () =>
    document.querySelector("#open").shadowRoot.querySelector("input").focus(),
  );
  await state(true, "open shadow password");
  await execute(
    page,
    () =>
      (document.querySelector("#open").shadowRoot.querySelector("input").type =
        "text"),
  );
  await state(false, "open shadow type mutation");
  await execute(page, () => {
    const root = document.querySelector("#open").shadowRoot;
    root.querySelector("#shadow").type = "password";
    root.querySelector("#shadow-plain").focus();
  });
  await state(false, "open shadow ordinary field");
  await execute(page, () =>
    document.querySelector("#open").shadowRoot.querySelector("#shadow").focus(),
  );
  await state(true, "intra-shadow ordinary to password focus");
  await execute(page, () =>
    document
      .querySelector("#open")
      .shadowRoot.querySelector("#shadow-plain")
      .focus(),
  );
  await state(false, "intra-shadow password to ordinary focus");
  await execute(page, () => window.focusClosed());
  await state(true, "closed shadow conservative protection");
  await field(page, "#plain");
  await state(false, "leave opaque host");
  const child = page.mainFrame.frames[0];
  await child.executeJavaScript(`document.querySelector('#plain').focus()`);
  await state(true, "iframe ordinary field conservative protection");
  await field(page, "#plain");
  await state(false, "return to known main frame");

  await field(page, "#password");
  await state(true, "password before hiding tab");
  manager.setVisible({
    hostWindow: window,
    request: { tabId: "secure-smoke", visible: false },
  });
  await state(false, "hidden tab while native first responder persists");
  window.webContents.focus();
  await field(window.webContents, "#password");
  await state(true, "host auth prompt after hiding browser");
  await field(window.webContents, "#plain");
  manager.setVisible({
    hostWindow: window,
    request: { tabId: "secure-smoke", visible: true },
  });
  await field(page, "#password");
  await state(true, "restored browser tab");

  manager.setPopupTabs({
    hostWindow: window,
    request: { tabIds: ["secure-smoke"] },
  });
  await execute(page, () =>
    window
      .open("about:blank")
      .document.write('<input id="popup-password" type="password">'),
  );
  await waitFor(
    async () =>
      (await execute(window.webContents, () => window.lastPopup))?.kind ===
      "opened",
    "managed popup",
  );
  const popupId = (await execute(window.webContents, () => window.lastPopup))
    .tabId;
  manager.setVisible({
    hostWindow: window,
    request: { tabId: "secure-smoke", visible: false },
  });
  manager.attach({
    hostWindow: window,
    request: { tabId: popupId, url: "about:blank", bounds, visible: true },
  });
  const popup = window.contentView.children.find(
    (candidate) => candidate.webContents && candidate.webContents !== page,
  ).webContents;
  await field(popup, "#popup-password");
  await state(true, "managed popup password");
  manager.detach({ hostWindow: window, tabId: popupId });
  await state(false, "popup detach");
  manager.setVisible({
    hostWindow: window,
    request: { tabId: "secure-smoke", visible: true },
  });
  await field(page, "#password");
  await state(true, "before app deactivation");
  app.hide();
  await state(false, "real app hide/deactivation");
  await activate(window, page);
  await field(page, "#password");
  await state(true, "app reactivation");
  powerMonitor.emit("lock-screen");
  powerMonitor.emit("suspend");
  await state(false, "simulated lock/suspend events");
  powerMonitor.emit("resume");
  await state(false, "resume while locked");
  powerMonitor.emit("unlock-screen");
  await state(true, "unlock current password");

  await execute(page, () => {
    document.open();
    document.write('<input id="plain"><input id="password" type="password">');
    document.close();
    document.querySelector("#plain").focus();
  });
  await state(false, "ordinary field after document.open rewrite");
  await field(page, "#password");
  await state(true, "password focus after document.open rewrite");

  const canceled = page.loadURL(url + "slow").catch((error) => {
    assert.ok(["ERR_ABORTED", "ERR_FAILED"].includes(error.code));
  });
  await waitFor(() => slowRequested, "provisional slow navigation");
  await state(true, "password during provisional navigation");
  page.stop();
  await canceled;
  assert.equal(page.getURL(), url);
  await field(page, "#plain");
  await state(false, "ordinary field after navigation cancellation");
  await field(page, "#password");
  await state(true, "password after navigation cancellation");

  await page.loadURL(url + "?reload");
  await field(page, "#plain");
  await state(false, "navigation to ordinary field");
  page.navigationHistory.goBack();
  await waitFor(
    () => page.getURL() === url && !page.isLoading(),
    "history restore",
  );
  await field(page, "#password");
  await state(true, "password after history restore");
  await field(page, "#plain");
  await state(false, "ordinary focus before closed body shadow");
  await execute(page, () => {
    const root = document.body.attachShadow({ mode: "closed" });
    root.innerHTML = '<input type="password">';
    root.querySelector("input").focus();
  });
  await state(true, "closed body shadow password conservative protection");
  // A closed body root makes the retained document opaque; replace it to test crash.
  await page.loadURL(url + "?after-body-shadow");
  await field(page, "#password");
  await state(true, "password before crash");
  const gone = once(page, "render-process-gone");
  page.forcefullyCrashRenderer();
  await gone;
  await state(false, "real renderer crash");
  manager.detach({ hostWindow: window, tabId: "secure-smoke" });
  await state(false, "final detach");
  assert.ok(reports.length > 5);
  assert.ok(
    reports.every(
      (report) =>
        Object.keys(report).sort().join(",") === "documentId,protect" &&
        typeof report.documentId === "string" &&
        typeof report.protect === "boolean",
    ),
  );
  finish();
})().catch(finish);
