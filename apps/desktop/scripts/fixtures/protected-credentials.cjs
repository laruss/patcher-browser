const { app, BrowserWindow, safeStorage, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createServer } = require("node:https");
const { randomUUID } = require("node:crypto");
const root = process.env.PATCHER_CREDENTIAL_SMOKE_ROOT;
const runtime = require(join(root, "runtime.cjs"));
app.setPath("userData", join(root, "profile"));
process.on("uncaughtException", (error) => {
  console.error(error);
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error(error);
  process.exit(1);
});
app.on(
  "certificate-error",
  (event, _contents, url, _error, _certificate, callback) => {
    if (new URL(url).hostname === "127.0.0.1") {
      event.preventDefault();
      callback(true);
    } else callback(false);
  },
);
const sentinel = "credential-fixture-SECRET-Ω-8731";
const login =
  '<form><label>Username<input id="username" autocomplete="username" value="alice"></label><label>Password<input id="password" type="password" autocomplete="current-password"></label></form>';
let window, session, server, origin, context;
let captureCount = 0,
  fillCount = 0,
  heldFill;
let nativeApproved = false,
  touchCount = 0,
  touchMode = "success",
  saved;
const page = () => window.webContents;
const evaluate = (code) => page().executeJavaScript(code);
const target = () => ({
  context: { ...context },
  current: () => ({ ...context }),
  hostWebContentsId: page().id,
  credentials: {
    webContentsId: page().id,
    interactive: () => !window.isDestroyed() && window.isVisible(),
    rememberPassword() {},
    send: (method, params) => session.send(method, params),
    execute: (code) => {
      if (heldFill && code.includes(".fill(")) {
        heldFill.code = code;
        heldFill.promise = new Promise((resolve) => {
          heldFill.resume = resolve;
        }).then(() =>
          page().executeJavaScriptInIsolatedWorld(1741, [{ code }]),
        );
        return heldFill.promise;
      }
      return page().executeJavaScriptInIsolatedWorld(1741, [{ code }]);
    },
  },
});
async function form(html = login) {
  await evaluate(`document.body.innerHTML = ${JSON.stringify(html)}`);
}
async function settlePending(vault) {
  for (let count = 0; count < 200; count++) {
    if (vault.list(page().id).length) return vault.list(page().id)[0];
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw Error("Pending request never became visible");
}
async function run() {
  await app.whenReady();
  server = createServer(
    {
      key: readFileSync(join(root, "key.pem")),
      cert: readFileSync(join(root, "cert.pem")),
    },
    (_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(
        `<!doctype html><style>input{display:block;width:250px;height:30px}label{display:block;margin:10px}</style>${login}`,
      );
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `https://127.0.0.1:${server.address().port}`;
  window = new BrowserWindow({
    width: 600,
    height: 500,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(root, "preload.cjs"),
    },
  });
  await page().loadURL(`${origin}/login`);
  context = {
    tabId: "tab",
    url: page().getURL(),
    origin,
    documentId: randomUUID(),
  };
  session = runtime.createCdpSession({ target: page().debugger });
  const sites = runtime.createDesktopSiteAuthority({
    resolve: () => target(),
    confirm: async () => true,
    changed() {},
  });
  const policy = {
    pluginId: "fixture",
    name: "Fixture",
    revision: randomUUID(),
    enabled: true,
    sites: [`${origin}/*`],
    origins: [origin],
    permissions: ["credentials.manage"],
    scripts: [],
    styles: [],
  };
  const backend = {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  };
  assert.equal(
    backend.available(),
    true,
    "real macOS OS encryption backend must be available",
  );
  const keys = runtime.createCredentialKeyStore(
    join(root, "vault", "key.bin"),
    backend,
  );
  const vault = runtime.createCredentialVault({
    sites,
    keys,
    available: backend.available,
    ready: () => true,
    changed() {},
    confirm: async () => {
      nativeApproved = true;
      return "require-touch-id";
    },
    touchIdAvailable: () => true,
    touchId: async () => {
      touchCount++;
      if (touchMode === "cancel") throw Error("Fixture biometric cancelled");
    },
  });
  const manual = new Map();
  ipcMain.on("patcher-desktop:credentials:consume-release", (event, input) => {
    const entry = manual.get(input.token);
    let value;
    if (entry === input.operation) {
      manual.delete(input.token);
      value =
        entry === "fill" ? { username: "alice", password: sentinel } : true;
    } else
      value = vault.take(
        input.token,
        input.operation,
        event.sender.id,
        event.senderFrame.url,
      );
    event.returnValue = value;
    if (
      value &&
      (input.operation === "capture" || input.operation === "fill")
    ) {
      assert.equal(nativeApproved, true);
      if (input.operation === "capture") captureCount++;
      else fillCount++;
    }
  });
  const manualPrepare = async () => {
    const token = randomUUID();
    manual.set(token, "prepare");
    return runtime.prepareCredentialForm(
      target(),
      () => {},
      new AbortController().signal,
      token,
    );
  };
  assert.equal(
    await evaluate("typeof globalThis.__patcherCredentialRelease"),
    "undefined",
  );
  assert.equal(
    await page().executeJavaScriptInIsolatedWorld(9001, [
      { code: "typeof globalThis.__patcherCredentialRelease" },
    ]),
    "undefined",
  );
  await sites.request("site.policy", policy, new AbortController().signal);
  async function proposal(operation, record) {
    const signal = new AbortController();
    const lease = await sites.request(
      "site.context",
      {
        owners: [{ pluginId: "fixture", revision: policy.revision }],
        tabId: "tab",
      },
      signal.signal,
    );
    nativeApproved = false;
    const promise = vault.request(
      "credential.operation",
      {
        token: lease.token,
        owner: "fixture",
        sourceHash: "a".repeat(64),
        request:
          operation === "save"
            ? { operation, tabId: "tab", accountId: "account" }
            : {
                operation,
                tabId: "tab",
                reference: { id: record.id, version: record.version },
              },
        ...(record
          ? { record }
          : { draft: { id: randomUUID(), createdAt: Date.now() } }),
      },
      signal.signal,
    );
    const pending = await settlePending(vault);
    return { signal, promise, pending, lease };
  }
  await evaluate(
    `document.getElementById('password').value = ${JSON.stringify(sentinel)}`,
  );
  const first = await proposal("save");
  assert.equal(captureCount, 0);
  assert.equal(touchCount, 0);
  const uiResult = await vault.review(first.pending.id, page().id);
  const response = await first.promise;
  saved = response.record;
  assert.equal(uiResult.status, "saved");
  assert.equal(captureCount, 1);
  assert.equal(touchCount, 1);
  assert(!JSON.stringify([uiResult, response]).includes(sentinel));
  await sites.request(
    "site.release",
    { token: first.lease.token },
    first.signal.signal,
  );
  const restored = runtime.createCredentialKeyStore(
    join(root, "vault", "key.bin"),
    backend,
  );
  assert.equal(
    restored.open(saved, (value) => value),
    sentinel,
  );
  console.log(
    "PASS inert pending, native presence gate, OS-sealed restart, metadata-only responses",
  );

  await session.enableDomain("Accessibility");
  const ax = await session.send("Accessibility.getFullAXTree");
  const nodes = await runtime.redactCredentialNodes(
    session,
    ax.nodes,
    page(),
    context.documentId,
  );
  const snapshot = runtime.buildBrowserSnapshot({ nodes });
  assert(snapshot.text.includes("alice"));
  assert(!snapshot.text.includes(sentinel));
  assert(
    !(await evaluate(
      `document.body.innerText.includes(${JSON.stringify(sentinel)})`,
    )),
  );
  console.log(
    "PASS real AX redacts password while preserving username; innerText excludes password",
  );

  for (const html of [
    login.replace('type="password"', 'type="password" readonly'),
    login.replace("<form>", '<form style="opacity:0">'),
    login.replace('type="password"', 'type="password" style="opacity:0"'),
    login
      .replace("<form>", "<form><fieldset disabled>")
      .replace("</form>", "</fieldset></form>"),
    login.replace("</form>", '<input type="password"></form>'),
    login.replace("<form>", '<form action="https://other.example/login">'),
    '<form><input type="password" autocomplete="new-password"></form>',
    '<iframe srcdoc="<form><input type=password></form>"></iframe>',
  ]) {
    await form(html);
    await assert.rejects(manualPrepare());
  }
  await form();
  const pinned = await manualPrepare();
  await evaluate(
    "document.getElementById('password').outerHTML = '<input id=password type=password>'",
  );
  const rejectedToken = randomUUID();
  manual.set(rejectedToken, "fill");
  await assert.rejects(pinned.fill(rejectedToken));
  await pinned.close();
  fillCount = 0; // Subsequent assertions count only the atomic-fill scenario.
  console.log(
    "PASS ambiguous/readonly/new-password/cross-origin/iframe forms and replaced node refused",
  );

  await form(login.replace('value="alice"', 'value=""'));
  await evaluate(
    "window.observed = false; const old = document.getElementById('password'); document.getElementById('username').addEventListener('input', () => { window.observed = old.value.length > 10; document.querySelector('form').outerHTML = '<form><input id=username><input id=password type=password></form>'; });",
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const filled = await proposal("fill", saved);
  assert.equal(fillCount, 0);
  assert.equal(
    (await vault.review(filled.pending.id, page().id)).status,
    "filled",
  );
  await filled.promise;
  assert.equal(await evaluate("window.observed"), true);
  assert.equal(await evaluate("document.getElementById('password').value"), "");
  assert.equal(fillCount, 1);
  console.log(
    "PASS username listener sees both assignments; replacement form is not filled; no retry/submit",
  );

  await form();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  touchMode = "cancel";
  const cancelled = await proposal("fill", saved);
  assert.equal(
    (await vault.review(cancelled.pending.id, page().id)).status,
    "denied",
  );
  await cancelled.promise;
  assert.equal(fillCount, 1);
  assert.equal(await evaluate("document.getElementById('password').value"), "");
  console.log("PASS biometric cancellation does not fill");
  await form();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  touchMode = "success";
  const late = await proposal("fill", saved);
  heldFill = {};
  const lateReview = vault.review(late.pending.id, page().id);
  while (!heldFill.code) await new Promise((resolve) => setTimeout(resolve, 5));
  assert(!heldFill.code.includes(sentinel));
  late.signal.abort();
  assert.equal((await lateReview).status, "cancelled");
  await late.promise;
  heldFill.resume();
  await assert.rejects(heldFill.promise);
  assert.equal(fillCount, 1);
  assert.equal(await evaluate("document.getElementById('password').value"), "");
  console.log(
    "PASS delayed fill carries only a token; cancellation refuses its late release in the private world",
  );
  heldFill = undefined;
  await form();
  await evaluate(
    `document.getElementById('password').value = ${JSON.stringify(sentinel + "-updated")}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const update = await proposal("update", saved);
  assert.equal(
    (await vault.review(update.pending.id, page().id)).status,
    "updated",
  );
  const updated = await update.promise;
  assert.equal(updated.record.id, saved.id);
  assert.equal(updated.record.version, 2);
  assert.equal(updated.record.protection, "require-touch-id");
  assert.equal(
    restored.open(updated.record, (value) => value),
    sentinel + "-updated",
  );
  assert(!JSON.stringify(updated).includes(sentinel));
  await form("<p>No credential form</p>");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const deletion = await proposal("delete", updated.record);
  assert.equal(
    (await vault.review(deletion.pending.id, page().id)).status,
    "deleted",
  );
  assert.deepEqual(await deletion.promise, { result: { status: "deleted" } });
  console.log(
    "PASS approved update increments the sealed version and retains policy; delete needs approval without reading a form",
  );
  await require("./password-manager.cjs")({
    root,
    runtime,
    vault,
    sites,
    policy,
    backend,
    page,
    context,
    evaluate,
    form,
    login,
    sentinel,
    settlePending,
    resetApproval: () => {
      nativeApproved = false;
    },
  });
  vault.close();
  session.detach();
  window.destroy();
  await new Promise((resolve) => server.close(resolve));
  app.exit(0);
}
run().catch((error) => {
  console.error(error);
  app.exit(1);
});
