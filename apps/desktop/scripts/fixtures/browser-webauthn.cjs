const { app, BrowserWindow, session, systemPreferences } = require("electron");
const { createServer } = require("node:http");
const { join } = require("node:path");
const assert = require("node:assert/strict");
const { once } = require("node:events");

app.setPath(
  "userData",
  join(process.env.PATCHER_WEBAUTHN_SMOKE_ROOT, "profile"),
);
const nativeMode = process.env.PATCHER_WEBAUTHN_SMOKE_NATIVE === "1";
const deadline = setTimeout(() => {
  console.error("WebAuthn smoke harness deadline exceeded");
  app.exit(1);
}, 30_000);
const servers = [];

async function startServer() {
  const server = createServer((request, response) => {
    response.writeHead(200, {
      "content-type": "text/html",
      "Content-Security-Policy": "script-src 'nonce-fixture'",
      "Permissions-Policy":
        "publickey-credentials-create=*, publickey-credentials-get=*",
    });
    response.end(`<!doctype html><script nonce="fixture">
      window.firstScriptConditional = PublicKeyCredential.isConditionalMediationAvailable();
      window.firstScriptCapabilities = PublicKeyCredential.getClientCapabilities();
      window.nodeExposed = typeof require !== 'undefined' || typeof process !== 'undefined' || typeof patcherDesktop !== 'undefined';
    </script>`);
  });
  await new Promise((resolve) => server.listen(0, "::", resolve));
  servers.push(server);
  return server.address().port;
}

function execute(frame, func, ...args) {
  return frame.executeJavaScript(
    `(${func.toString()})(...${JSON.stringify(args)})`,
  );
}

async function checkContext(frame, label) {
  const result = await execute(frame, async () => ({
    conditional: await window.firstScriptConditional,
    capabilities: await window.firstScriptCapabilities,
    platform:
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
    nodeExposed: window.nodeExposed,
  }));
  assert.equal(
    result.conditional,
    nativeMode,
    `${label}: first script capability`,
  );
  assert.equal(result.nodeExposed, false, `${label}: no Node or app bridge`);
  for (const capability of ["conditionalCreate", "conditionalGet"]) {
    assert.equal(
      result.capabilities[capability],
      nativeMode,
      `${label}: ${capability}`,
    );
  }
  return { label, ...result };
}

async function requestCases(frame, baseline) {
  return execute(
    frame,
    async (native) => {
      function creation() {
        return {
          challenge: new Uint8Array(32),
          rp: { name: "Fixture", id: "localhost" },
          user: {
            id: new Uint8Array([1]),
            name: "fixture",
            displayName: "Fixture",
          },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          timeout: 25,
          authenticatorSelection: { authenticatorAttachment: "platform" },
        };
      }
      async function settle(method, options) {
        const start = performance.now();
        try {
          await Promise.race([
            navigator.credentials[method](options),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("harness deadline")), 1000),
            ),
          ]);
          return { resolved: true };
        } catch (error) {
          return {
            name: error.name,
            message: error.message,
            elapsedMs: performance.now() - start,
          };
        }
      }
      const platform = await settle("create", {
        publicKey: creation(),
        ...(native ? { signal: AbortSignal.timeout(100) } : {}),
      });
      const conditional = await settle("get", {
        publicKey: { challenge: new Uint8Array(32) },
        mediation: "conditional",
        ...(native ? { signal: AbortSignal.timeout(100) } : {}),
      });
      const timeout = await settle("get", {
        publicKey: { challenge: new Uint8Array(32), timeout: 25 },
        ...(native ? { signal: AbortSignal.timeout(100) } : {}),
      });
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 25);
      const cancelled = await settle("get", {
        publicKey: { challenge: new Uint8Array(32) },
        signal: controller.signal,
      });
      const aborted = new AbortController();
      aborted.abort();
      const preaborted = await settle("get", {
        publicKey: { challenge: new Uint8Array(32) },
        signal: aborted.signal,
      });
      const nonPublicKey = await settle("get", { mediation: "optional" });
      const invalidOptions = {};
      for (const method of ["create", "get"]) {
        // A synchronous throw fails the fixture: sites use .catch() for fallback.
        invalidOptions[method + "Null"] = await navigator.credentials[method]({
          publicKey: null,
        }).catch((error) => error.name);
        invalidOptions[method + "Throwing"] = await navigator.credentials[
          method
        ]({
          get publicKey() {
            throw new Error("getter failed");
          },
        }).catch((error) => error.message);
        let reads = 0;
        invalidOptions[method + "Count"] = await navigator.credentials[method]({
          get publicKey() {
            reads++;
            return {};
          },
        }).catch((error) => error.name);
        invalidOptions[method + "Reads"] = reads;
      }
      return {
        platform,
        conditional,
        timeout,
        cancelled,
        preaborted,
        nonPublicKey,
        invalidOptions,
      };
    },
    baseline,
  );
}

async function assertRequestCases(frame) {
  const results = await requestCases(frame, nativeMode);
  for (const name of ["platform", "conditional", "timeout"]) {
    assert.equal(
      results[name].name,
      nativeMode ? "TimeoutError" : "NotAllowedError",
      name,
    );
    assert.ok(
      results[name].elapsedMs < 800,
      `${name}: page settled before watchdog`,
    );
  }
  assert.equal(results.cancelled.name, "AbortError");
  assert.equal(results.preaborted.name, "AbortError");
  for (const method of ["create", "get"]) {
    assert.equal(results.invalidOptions[method + "Null"], "TypeError");
    assert.equal(results.invalidOptions[method + "Throwing"], "getter failed");
    assert.equal(results.invalidOptions[method + "Count"], "TypeError");
    assert.equal(results.invalidOptions[method + "Reads"], 1);
  }
  return results;
}

async function exerciseSecurityKey(contents) {
  // Only the test attaches a debugger; production policy has no CDP dependency.
  contents.debugger.attach("1.3");
  await contents.debugger.sendCommand("WebAuthn.enable");
  const { authenticatorId } = await contents.debugger.sendCommand(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "usb",
        hasResidentKey: false,
        hasUserVerification: false,
        automaticPresenceSimulation: true,
      },
    },
  );
  const result = await execute(contents.mainFrame, async () => {
    const created = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "Fixture", id: "localhost" },
        user: {
          id: new Uint8Array([1]),
          name: "fixture",
          displayName: "Fixture",
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: {
          authenticatorAttachment: "cross-platform",
          residentKey: "discouraged",
          userVerification: "discouraged",
        },
        timeout: 1000,
      },
    });
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: "localhost",
        allowCredentials: [
          { id: created.rawId, type: "public-key", transports: ["usb"] },
        ],
        userVerification: "discouraged",
        timeout: 1000,
      },
    });
    return {
      created: created.type,
      asserted: assertion.type,
      sameId: created.id === assertion.id,
    };
  });
  assert.deepEqual(result, {
    created: "public-key",
    asserted: "public-key",
    sameId: true,
  });
  await contents.debugger.sendCommand("WebAuthn.removeVirtualAuthenticator", {
    authenticatorId,
  });
  contents.debugger.detach();
  return result;
}

(async () => {
  await app.whenReady();
  const port = await startServer();
  const crossPort = await startServer();
  const browserSession = session.fromPartition("persist:webauthn-smoke");
  if (!nativeMode)
    await browserSession.extensions.loadExtension(
      process.env.PATCHER_WEBAUTHN_SMOKE_EXTENSION,
    );
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: browserSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.on("preload-error", (_event, _path, error) => {
    throw error;
  });
  const url = `http://localhost:${port}/`;
  await win.loadURL(url);
  const contexts = [await checkContext(win.webContents.mainFrame, "main")];
  await execute(
    win.webContents.mainFrame,
    async (cross) => {
      for (const source of ["/same", `http://localhost:${cross}/cross`]) {
        const frame = document.createElement("iframe");
        frame.allow = "publickey-credentials-create; publickey-credentials-get";
        const ready = new Promise((resolve) => (frame.onload = resolve));
        frame.src = source;
        document.body.append(frame);
        await ready;
      }
      const frame = document.createElement("iframe");
      const ready = new Promise((resolve) => (frame.onload = resolve));
      frame.srcdoc = `<script nonce="fixture">window.firstScriptConditional = PublicKeyCredential.isConditionalMediationAvailable(); window.firstScriptCapabilities = PublicKeyCredential.getClientCapabilities(); window.nodeExposed = typeof require !== 'undefined' || typeof process !== 'undefined' || typeof patcherDesktop !== 'undefined';<\/script>`;
      document.body.append(frame);
      await ready;
    },
    crossPort,
  );
  for (const frame of win.webContents.mainFrame.frames)
    contexts.push(await checkContext(frame, "dynamic iframe"));
  const cases = await assertRequestCases(win.webContents.mainFrame);
  for (const frame of nativeMode ? [] : win.webContents.mainFrame.frames) {
    const child = await execute(frame, async () => {
      try {
        await navigator.credentials.get({
          publicKey: { challenge: new Uint8Array(32), timeout: 25 },
        });
      } catch (error) {
        return error.name;
      }
    });
    assert.equal(child, "NotAllowedError");
  }
  const securityKey = await exerciseSecurityKey(win.webContents);
  // A navigation cancels the pending native request and leaves the next page usable.
  await execute(win.webContents.mainFrame, () => {
    navigator.credentials
      .get({ publicKey: { challenge: new Uint8Array(32) } })
      .catch(() => {});
  });
  await win.loadURL(url);
  contexts.push(await checkContext(win.webContents.mainFrame, "after reload"));
  await exerciseSecurityKey(win.webContents);
  win.webContents.setWindowOpenHandler(() => ({
    action: "allow",
    overrideBrowserWindowOptions: { show: false },
  }));
  const popupCreated = once(win.webContents, "did-create-window");
  await execute(win.webContents.mainFrame, () => {
    window.open("/popup");
  });
  const [popup] = await popupCreated;
  if (popup.webContents.isLoading())
    await once(popup.webContents, "did-finish-load");
  contexts.push(await checkContext(popup.webContents.mainFrame, "popup"));
  if (!nativeMode) await assertRequestCases(popup.webContents.mainFrame);
  popup.destroy();
  console.log(
    JSON.stringify(
      {
        mode: nativeMode ? "native-baseline" : "compatibility",
        electron: process.versions.electron,
        chromium: process.versions.chrome,
        packaged: app.isPackaged,
        configureWebAuthn: typeof app.configureWebAuthn === "function",
        touchIDAvailable: systemPreferences.canPromptTouchID(),
        contexts,
        cases,
        securityKey,
      },
      null,
      2,
    ),
  );
  win.destroy();
  servers.forEach((server) => server.close());
  clearTimeout(deadline);
  app.exit(0);
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
