const { app, BrowserWindow, Menu, session, webContents } = require("electron");
const { createServer } = require("node:http");
const { join } = require("node:path");
const { readFileSync, writeFileSync } = require("node:fs");
const assert = require("node:assert/strict");
const root = process.env.PATCHER_CREDENTIAL_SMOKE_ROOT;
const dist = process.env.PATCHER_CREDENTIAL_SMOKE_DIST;
const runtime = require(join(root, "runtime.cjs"));
app.setName("Patcher Password Manager QA");
app.setPath("userData", join(root, "profile"));
let browser, host, server;
const results = [];
const deadline = setTimeout(
  () => finish(new Error("Password Manager fixture timed out")),
  process.env.PATCHER_PASSWORD_QA_REAL_AUTH ? 180_000 : 50_000,
);
function finish(error) {
  clearTimeout(deadline);
  browser?.destroyAll();
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  server?.close();
  if (error) console.error(error, results);
  else
    console.log(
      JSON.stringify({ electron: process.versions.electron, results }),
    );
  app.exit(error ? 1 : 0);
}
process.on("uncaughtException", finish);
process.on("unhandledRejection", finish);
async function waitFor(check, label, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${label}`);
}
const form =
  '<form action="/signed-in" method="get"><label>Username<input id="username" name="username" autocomplete="username"></label><label>Password<input id="password" type="password" autocomplete="current-password"></label><button>Sign in</button></form>';
const evaluate = (code) => host.webContents.executeJavaScript(code);
const click = (label) =>
  evaluate(
    `(() => { const button=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)} || e.getAttribute('aria-label')===${JSON.stringify(label)}); if(!button) throw Error('Missing button'); const r=button.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); if(!r.width || !r.height || !(hit===button || button.contains(hit))) throw Error('Button is obscured: ' + button.textContent); button.click(); })()`,
  );
const input = (label, value) =>
  evaluate(
    `(() => { const label=[...document.querySelectorAll('label')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(label)})); const input=label?.querySelector('input'); if(!input) throw Error('Missing input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`,
  );
(async () => {
  await app.whenReady();
  app.setActivationPolicy("prohibited");
  app.on("browser-window-created", (_event, window) => window.setOpacity(0));
  const records = new Map();
  let realAuth = false;
  let hardwareAuthResult;
  let delayAuthFocus = false;
  let enabled = true,
    authCount = 0,
    authAllowed = false;
  const hash = "a".repeat(64);
  const key = runtime.createCredentialKeyStore(join(root, "vault/key.bin"), {
    available: () => true,
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString(),
  });
  const manager = runtime.createPasswordManager({
    key: () => key,
    authenticate: async () => {
      authCount++;
      if (realAuth) {
        const success = await runtime.authenticatePasswordManager(
          process.env.PATCHER_PASSWORD_QA_AUTH_HELPER,
          "Show your saved test password",
          new AbortController().signal,
        );
        hardwareAuthResult = success;
        console.log("Hardware authentication result:", success);
        return success;
      }
      if (delayAuthFocus) {
        await host.webContents.debugger.sendCommand(
          "Emulation.setFocusEmulationEnabled",
          { enabled: false },
        );
        assert.equal(await evaluate("document.hasFocus()"), false);
        setTimeout(
          () =>
            void host.webContents.debugger.sendCommand(
              "Emulation.setFocusEmulationEnabled",
              { enabled: true },
            ),
          150,
        );
      }
      return authAllowed;
    },
    changed() {
      if (host && !host.isDestroyed())
        host.webContents.send(runtime.PASSWORD_MANAGER_CHANNELS.changed);
    },
    async store(request) {
      if (request.operation === "status")
        return enabled
          ? { enabled, sourceHash: hash, vault: records.values().next().value }
          : { enabled };
      if (!enabled) throw new Error("disabled");
      if (request.operation === "list") {
        const entries = [...records.values()]
          .filter(
            (entry) =>
              (!request.origin || entry.origin === request.origin) &&
              (!request.after || entry.id > request.after),
          )
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, 8);
        return {
          records: entries,
          after: entries.length === 8 ? entries.at(-1).id : null,
        };
      }
      if (request.operation === "delete") {
        records.delete(request.id);
        return true;
      }
      if (request.operation === "put") {
        records.set(request.record.id, request.record);
        return true;
      }
      for (const record of request.records) records.set(record.id, record);
      return true;
    },
  });
  server = createServer((req, res) => {
    const path = new URL(req.url, "http://fixture").pathname;
    if (path === "/async-result") {
      setTimeout(() => {
        res.writeHead(200);
        res.end("failed");
      }, 600);
      return;
    }
    if (path === "/async-ok") {
      res.end("ok");
      return;
    }
    if (path === "/async-fast") {
      res.end("failed");
      return;
    }
    if (path === "/analytics") {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    if (path === "/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: ready\n\n");
      return;
    }
    if (path === "/ui.js" || path === "/ui.css" || path === "/theme.css") {
      res.setHeader(
        "content-type",
        path.endsWith(".js") ? "text/javascript" : "text/css",
      );
      res.end(readFileSync(join(root, path.slice(1))));
      return;
    }
    res.setHeader("content-type", "text/html");
    if (path === "/login-csp")
      res.setHeader(
        "content-security-policy",
        "default-src 'self'; style-src 'none'",
      );
    if (path === "/login" || path === "/login-csp" || path === "/failed")
      res.end(
        `<!doctype html>${path === "/login-csp" ? "" : "<style>input{display:block;width:240px;height:32px;margin:12px}button{height:30px}</style>"}${form}`,
      );
    else if (path === "/signed-in")
      res.end("<!doctype html><h1>Signed in</h1>");
    else
      res.end(
        '<!doctype html><html class="dark"><head><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>',
      );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  host = new BrowserWindow({
    show: false,
    width: 1080,
    height: 760,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(root, "manager-preload.cjs"),
      backgroundThrottling: false,
    },
  });
  host.showInactive();
  runtime.registerPasswordManagerIpc({
    manager,
    authorize: (event) =>
      event.sender === host.webContents &&
      new URL(event.senderFrame.url).origin === origin,
  });
  await manager.refresh();
  await host.loadURL(origin);
  host.webContents.debugger.attach("1.3");
  await host.webContents.debugger.sendCommand(
    "Emulation.setFocusEmulationEnabled",
    { enabled: true },
  );
  runtime.installApplicationMenu({
    accelerators: {},
    passwordManagerEnabled: true,
    openPasswordManager: () =>
      host.webContents.send(runtime.PASSWORD_MANAGER_CHANNELS.open),
    createNewWindow() {},
    openNewTab() {},
    openNewThread() {},
    openSettings() {},
    reloadWindow() {},
    closeWindowOrSideTab() {},
    openServerDaemonLogs() {},
    selectServer() {},
    setServerUrl() {},
    serverDaemonLogsMenuEnabled: false,
    servers: [],
  });
  await waitFor(
    () => evaluate("document.body.textContent.includes('Browser shell')"),
    "UI startup",
  );
  const item = Menu.getApplicationMenu().items[0].submenu.items.find(
    (item) => item.label === "Password Manager",
  );
  assert.ok(item);
  item.click();
  await waitFor(
    () =>
      evaluate(
        "location.pathname === '/password-manager' && document.body.textContent.includes('Your saved passwords appear here')",
      ),
    "menu opens manager page",
  );
  await click("Add password");
  await input("Website", origin);
  await input("Username", "alice");
  await input("Password", "fixture-alice-secret");
  await click("Save");
  await waitFor(() => records.size === 1, "manual add");
  assert.equal(authCount, 0);
  assert.ok(
    !JSON.stringify([...records.values()]).includes("fixture-alice-secret"),
  );
  results.push(
    "native menu → real manager page → manual add; encrypted envelope only",
  );
  await waitFor(
    () => evaluate("!!document.querySelector('.password-manager-row')"),
    "list after add",
  );
  await evaluate("document.querySelector('.password-manager-row').click()");
  await click("Show password");
  await waitFor(() => authCount === 1, "native auth cancellation");
  assert.equal(
    await evaluate(
      "document.querySelector('.password-manager-secret input').type",
    ),
    "password",
  );
  authAllowed = true;
  delayAuthFocus = true;
  await click("Show password");
  await waitFor(
    () =>
      evaluate(
        "document.querySelector('.password-manager-secret input').value === 'fixture-alice-secret'",
      ),
    "native auth reveal",
  );
  delayAuthFocus = false;
  await click("Hide password");
  await click("Edit");
  await waitFor(
    () => evaluate("!!document.querySelector('[role=dialog]')"),
    "authenticated edit dialog",
  );
  await input("Password", "fixture-alice-updated");
  await click("Save");
  await waitFor(() => [...records.values()][0].version === 2, "edit saves");
  assert.equal(authCount, 3);
  await waitFor(
    () => evaluate("!document.querySelector('[role=dialog]')"),
    "editor closes after save",
  );
  await evaluate(
    "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
  );
  if (process.env.PATCHER_PASSWORD_QA_SCREENSHOT)
    writeFileSync(
      process.env.PATCHER_PASSWORD_QA_SCREENSHOT,
      (await host.webContents.capturePage()).toPNG(),
    );
  results.push("reveal cancelled/approved, masking and authenticated edit");
  session
    .fromPartition(runtime.PATCHER_BROWSER_PARTITION)
    .registerPreloadScript({
      id: "fixture-password-manager",
      type: "frame",
      filePath: join(dist, "password-manager-page-preload.cjs"),
    });
  browser = runtime.createDesktopBrowserViewManager({
    pageScriptPreloadPath: join(dist, "page-script-preload.cjs"),
    dispatchAppCommand() {},
    downloadPathExists: () => false,
    extractPdfText: async () => ({ ok: false, reason: "unreadable" }),
    focusHostWebContents() {},
    openDownloadPath: async () => "",
    openExternalUrl() {},
    revealDownloadPath() {},
    resolveDownloadDirectory: () => root,
    resolveAppCommand: () => null,
  });
  const integration = runtime.registerPasswordManagerBrowser({
    manager,
    browser: () => browser,
    canPrompt: () => true,
  });
  browser.attach({
    hostWindow: host,
    request: {
      tabId: "login",
      url: `${origin}/login`,
      bounds: { x: 0, y: 0, width: 1080, height: 700 },
      visible: false,
    },
  });
  session
    .fromPartition(runtime.PATCHER_BROWSER_PARTITION)
    .webRequest.onBeforeRequest((_details, callback) =>
      callback({ cancel: false }),
    );
  let page;
  await waitFor(() => {
    page = webContents
      .getAllWebContents()
      .find((contents) => browser.passwordTarget(contents.id));
    return !!page;
  }, "tracked browser view");
  page.on("console-message", (event) => {
    if (event.level === "error")
      console.error("Fixture page error:", event.message);
  });
  await waitFor(
    () =>
      page.executeJavaScript(
        "document.getElementById('password')?.value === 'fixture-alice-updated'",
      ),
    "automatic fill in real Chromium",
  );
  browser.setVisible({
    hostWindow: host,
    request: { tabId: "login", visible: true },
  });
  results.push("background agent tab fills without system authentication");
  assert.equal(authCount, 3);
  assert.equal(
    await page.executeJavaScript("typeof window.patcherDesktop"),
    "undefined",
  );
  await page.executeJavaScript(
    "const input=document.getElementById('password'); input.value=''; input.dispatchEvent(new Event('input',{bubbles:true})); document.body.append(document.createElement('div'));",
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    await page.executeJavaScript("document.getElementById('password').value"),
    "",
  );
  results.push(
    "automatic fill without auth; private preload; cleared field stays empty",
  );
  await page.executeJavaScript(
    "document.getElementById('username').value='bob'; document.getElementById('password').value='fixture-bob-secret'; document.querySelector('form').requestSubmit();",
  );
  let bubble;
  await waitFor(async () => {
    bubble = BrowserWindow.getAllWindows().find(
      (window) =>
        window !== host &&
        window.webContents.getURL().startsWith("data:text/html"),
    );
    return (
      bubble &&
      (await bubble.webContents.executeJavaScript(
        "document.getElementById('title')?.textContent === 'Save password?'",
      ))
    );
  }, "after-navigation Save proposal");
  assert.equal(records.size, 1);
  await bubble.webContents.executeJavaScript(
    "document.getElementById('save').click()",
  );
  await waitFor(() => records.size === 2, "explicit Save persists");
  assert.equal(authCount, 3);
  results.push(
    "capture survives navigation; Save writes only after confirmation",
  );
  integration.reset();
  await browser
    .passwordTarget(page.id)
    .credentials.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.loadURL(`${origin}/login-csp`);
  await waitFor(
    () => page.executeJavaScript("!!document.getElementById('username')"),
    "CSP login",
  );
  // Let the first metadata request finish before focusing the username field.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await page.executeJavaScript("document.getElementById('username').focus()");
  await waitFor(
    () => page.executeJavaScript("!!document.querySelector('[role=listbox]')"),
    "account suggestions",
  );
  assert.equal(
    await page.executeJavaScript(
      "document.querySelector('[role=listbox]').shadowRoot",
    ),
    null,
  );
  const suggestions = await browser.snapshot({
    hostWindow: host,
    request: { tabId: "login" },
  });
  assert.ok(
    suggestions.ok &&
      suggestions.snapshot.includes("alice") &&
      suggestions.snapshot.includes("bob"),
  );
  if (process.env.PATCHER_PASSWORD_QA_SCREENSHOT)
    writeFileSync(
      process.env.PATCHER_PASSWORD_QA_SCREENSHOT.replace(
        /\.png$/u,
        "-picker.png",
      ),
      (await page.capturePage()).toPNG(),
    );
  const send = (method, params) =>
    browser.passwordTarget(page.id).credentials.send(method, params);
  const press = async (key, code) => {
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      windowsVirtualKeyCode: code,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      windowsVirtualKeyCode: code,
    });
  };
  page.focus();
  await page.executeJavaScript(
    "window.qaKeys=[]; window.addEventListener('keydown', e=>window.qaKeys.push({key:e.key,trusted:e.isTrusted,target:e.target.id,focused:document.hasFocus()}),true)",
  );
  assert.equal(
    await page.executeJavaScript("document.activeElement?.id"),
    "username",
  );
  const accountOptions = [];
  function collectOptions(node) {
    const attributes = node.attributes ?? [];
    if (attributes[attributes.indexOf("role") + 1] === "option")
      accountOptions.push({
        name: (node.children ?? [])
          .map((child) => child.nodeValue ?? "")
          .join(""),
        selected:
          attributes[attributes.indexOf("aria-selected") + 1] === "true",
      });
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])])
      collectOptions(child);
  }
  collectOptions(
    (await send("DOM.getDocument", { depth: -1, pierce: true })).root,
  );
  assert.deepEqual(accountOptions.map((option) => option.name).sort(), [
    "alice",
    "bob",
  ]);
  const selectedOption = accountOptions.find((option) => option.selected);
  assert.ok(selectedOption, "The picker must expose its highlighted account");
  // Exercise keyboard navigation even when Bob happens to be highlighted first.
  if (selectedOption.name === "bob") await press("ArrowDown", 40);
  await press("ArrowDown", 40);
  await press("Enter", 13);
  await waitFor(
    () =>
      page.executeJavaScript(
        "document.getElementById('password').value === 'fixture-bob-secret'",
      ),
    "keyboard account selection",
  ).catch(async (error) => {
    console.error("Keyboard picker state:", {
      initial: accountOptions,
      page: await page.executeJavaScript(
        "({keys:window.qaKeys,focused:document.hasFocus(),active:document.activeElement?.id,path:location.pathname,username:document.getElementById('username')?.value,alice:document.getElementById('password')?.value==='fixture-alice-updated',bob:document.getElementById('password')?.value==='fixture-bob-secret'})",
      ),
    });
    throw error;
  });
  await page.executeJavaScript(
    "document.getElementById('password').type = 'text'",
  );
  const redacted = await browser.snapshot({
    hostWindow: host,
    request: { tabId: "login" },
  });
  assert.ok(!redacted.snapshot.includes("fixture-bob-secret"));
  results.push(
    "keyboard account selection under strict CSP; closed shadow; AX redaction survives password toggle",
  );

  integration.reset();
  await page.loadURL(`${origin}/login`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await page.executeJavaScript("document.getElementById('username').focus()");
  await send("Input.insertText", { text: "bob" });
  await waitFor(
    () =>
      page.executeJavaScript(
        "document.getElementById('password').value === 'fixture-bob-secret'",
      ),
    "typing remains editable with suggestions",
  );
  results.push(
    "typing a saved username fills its password without taking keyboard focus",
  );

  await page.executeJavaScript(
    "document.getElementById('password').value='fixture-bob-new'; document.querySelector('form').requestSubmit()",
  );
  await waitFor(async () => {
    bubble = BrowserWindow.getAllWindows().find(
      (window) =>
        window !== host &&
        window.webContents.getURL().startsWith("data:text/html"),
    );
    return (
      bubble &&
      (await bubble.webContents.executeJavaScript(
        "document.getElementById('title')?.textContent === 'Update password?'",
      ))
    );
  }, "Update proposal after changed website login");
  assert.equal(
    [...records.values()].find((record) => record.username === "bob").version,
    1,
  );
  await bubble.webContents.executeJavaScript(
    "document.getElementById('save').click()",
  );
  await waitFor(
    () =>
      [...records.values()].find((record) => record.username === "bob")
        .version === 2,
    "explicit website Update",
  );
  assert.equal(authCount, 3);
  results.push("website Update confirms once without OS authentication");

  integration.reset();
  await page.loadURL(`${origin}/login`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await page.executeJavaScript(
    `document.getElementById('username').value='carol'; document.getElementById('password').value='rejected-secret'; document.querySelector('form').addEventListener('submit', async event => { event.preventDefault(); document.body.innerHTML='<p>Loading</p>'; await fetch('/async-result'); document.body.innerHTML=${JSON.stringify("<p>Incorrect password</p>" + form)}; }); document.querySelector('form').requestSubmit();`,
  );
  await waitFor(
    () =>
      page.executeJavaScript(
        "document.body.textContent.includes('Incorrect password')",
      ),
    "SPA failure response",
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    BrowserWindow.getAllWindows().filter((window) => window !== host).length,
    0,
  );
  assert.equal(records.size, 2);
  results.push(
    "failed AJAX login with spinner/replacement form never offers Save",
  );

  integration.reset();
  await page.loadURL(`${origin}/login`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await page.executeJavaScript(
    "document.getElementById('username').value='carol'; document.getElementById('password').value='carol-secret'; document.querySelector('form').addEventListener('submit', async event => { event.preventDefault(); await fetch('/async-ok'); document.body.innerHTML='<h1>Signed in</h1>'; }); document.querySelector('form').requestSubmit();",
  );
  await waitFor(async () => {
    bubble = BrowserWindow.getAllWindows().find(
      (window) =>
        window !== host &&
        window.webContents.getURL().startsWith("data:text/html"),
    );
    return (
      bubble &&
      (await bubble.webContents.executeJavaScript(
        "document.getElementById('title')?.textContent === 'Save password?'",
      ))
    );
  }, "successful SPA Save");
  await bubble.webContents.executeJavaScript(
    "document.getElementById('cancel').click()",
  );
  await waitFor(() => bubble.isDestroyed(), "Not now closes Save");
  assert.equal(records.size, 2);
  results.push("successful SPA offers Save; Not now preserves records");
  integration.reset();
  await page.loadURL(`${origin}/login`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await page.executeJavaScript(
    "document.getElementById('username').value='carol'; document.getElementById('password').value='carol-route-secret'; document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); history.pushState({}, '', '/dashboard'); setTimeout(() => { document.body.innerHTML='<h1>Signed in</h1>'; }, 30); }); document.querySelector('form').requestSubmit();",
  );
  await waitFor(async () => {
    bubble = BrowserWindow.getAllWindows().find(
      (window) =>
        window !== host &&
        window.webContents.getURL().startsWith("data:text/html"),
    );
    return (
      bubble &&
      (await bubble.webContents.executeJavaScript(
        "document.getElementById('title')?.textContent === 'Save password?'",
      ))
    );
  }, "SPA navigation before delayed form removal");
  await bubble.webContents.executeJavaScript(
    "document.getElementById('cancel').click()",
  );
  await waitFor(() => bubble.isDestroyed(), "route proposal closes");
  results.push(
    "SPA navigation retains the submission until its form disappears",
  );

  integration.reset();
  await page.loadURL(`${origin}/login`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await page.executeJavaScript(
    `document.getElementById('username').value='carol'; document.getElementById('password').value='fast-rejected'; document.querySelector('form').addEventListener('submit', async event => { event.preventDefault(); await fetch('/async-fast'); document.body.innerHTML=${JSON.stringify("<p>Wrong password</p>" + form)}; }); document.querySelector('form').requestSubmit();`,
  );
  await waitFor(
    () =>
      page.executeJavaScript(
        "document.body.textContent.includes('Wrong password')",
      ),
    "fast failed login",
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  await page.loadURL(`${origin}/help`);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(
    BrowserWindow.getAllWindows().filter((window) => window !== host).length,
    0,
  );
  results.push(
    "fast rejected SPA credentials are discarded before later navigation",
  );

  for (const endpoint of ["analytics", "stream"]) {
    integration.reset();
    await page.loadURL(`${origin}/login`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await page.executeJavaScript(
      `document.getElementById('username').value='carol'; const p=document.getElementById('password'); p.type='text'; p.value='carol-secret'; document.querySelector('form').addEventListener('submit', async event => { event.preventDefault(); await fetch('/async-ok'); document.body.innerHTML='<h1>Signed in</h1>'; void fetch('/${endpoint}').catch(()=>{}); }); document.querySelector('form').requestSubmit();`,
    );
    await waitFor(
      async () => {
        bubble = BrowserWindow.getAllWindows().find(
          (window) =>
            window !== host &&
            window.webContents.getURL().startsWith("data:text/html"),
        );
        return (
          bubble &&
          (await bubble.webContents.executeJavaScript(
            "document.getElementById('title')?.textContent === 'Save password?'",
          ))
        );
      },
      `visible-password Save with ${endpoint}`,
      7500,
    );
    await bubble.webContents.executeJavaScript(
      "document.getElementById('cancel').click()",
    );
    await waitFor(() => bubble.isDestroyed(), "proposal closes");
    assert.equal(records.size, 2);
  }
  results.push(
    "visible password capture; analytics errors and indefinite streams do not suppress Save",
  );
  enabled = false;
  integration.reset();
  await manager.refresh();
  await page.loadURL(`${origin}/login`);
  await waitFor(
    () => page.executeJavaScript("!!document.getElementById('password')"),
    "disabled login page",
  );
  assert.equal(
    await page.executeJavaScript("document.getElementById('password').value"),
    "",
  );
  assert.equal(records.size, 2);
  results.push("disable stops filling and preserves records");
  if (process.env.PATCHER_PASSWORD_QA_REAL_AUTH) {
    enabled = true;
    browser.setVisible({
      hostWindow: host,
      request: { tabId: "login", visible: false },
    });
    await manager.refresh();
    await host.webContents.debugger.sendCommand(
      "Emulation.setFocusEmulationEnabled",
      { enabled: false },
    );
    app.setActivationPolicy("regular");
    host.setOpacity(1);
    host.show();
    app.focus({ steal: true });
    host.focus();
    host.webContents.focus();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await waitFor(
      () =>
        evaluate("!!document.querySelector('.password-manager-secret input')"),
      "test password details",
    );
    realAuth = true;
    await evaluate(
      "window.qaFocusEvents=[]; for(const type of ['focus','blur']) window.addEventListener(type,()=>window.qaFocusEvents.push({type,focused:document.hasFocus()}));",
    );
    console.log(
      "Hardware check: waiting for Touch ID or the macOS login password.",
    );
    await evaluate(
      "const card=[...document.querySelectorAll('.password-manager-card')].find(card=>[...card.querySelectorAll('dd')].some(e=>e.textContent==='alice')); card.querySelector('[aria-label=\"Show password\"]').click();",
    );
    await waitFor(
      () => hardwareAuthResult !== undefined,
      "physical system authentication result",
      125_000,
    );
    assert.equal(
      hardwareAuthResult,
      true,
      "macOS must report successful authentication",
    );
    await waitFor(
      () =>
        evaluate(
          "[...document.querySelectorAll('.password-manager-card')].find(card=>[...card.querySelectorAll('dd')].some(e=>e.textContent==='alice')).querySelector('.password-manager-secret input').value === 'fixture-alice-updated'",
        ),
      "physical system authentication and UI reveal",
      5000,
    ).catch(async (error) => {
      console.error(
        "Hardware UI state:",
        await evaluate(
          "({focused:document.hasFocus(),hidden:document.hidden,events:window.qaFocusEvents,fields:[...document.querySelectorAll('.password-manager-secret input')].map(e=>({type:e.type,masked:e.type==='password'}))})",
        ),
      );
      throw error;
    });
    results.push(
      "PHYSICAL macOS authentication succeeded and revealed only the test password",
    );
  }
  finish();
})().catch(finish);
