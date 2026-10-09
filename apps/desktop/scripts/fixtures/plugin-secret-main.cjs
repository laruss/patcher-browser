const { app, safeStorage } = require("electron");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const root = process.env.PATCHER_SECRET_SMOKE_ROOT;
const phase = process.env.PATCHER_SECRET_SMOKE_PHASE;
const { createDesktopSecretBroker } = require(join(root, "broker.js"));
const { startPatcherAppProcess } = require(join(root, "process.js"));
app.setName("Patcher Secret Storage Smoke");
app.setPath("userData", join(root, "profile"));
let runtime;
let broker;
async function wait(check) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Native secret smoke timed out");
}
app
  .whenReady()
  .then(async () => {
    assert.equal(
      safeStorage.isEncryptionAvailable(),
      true,
      "OS Keychain backend unavailable",
    );
    runtime = startPatcherAppProcess({
      bridgePath: join(__dirname, "plugin-secret-launcher.cjs"),
      cwd: root,
      env: process.env,
      logLineLimit: 50,
      runtime: { executablePath: process.execPath, mode: "electron-node" },
      secretChannel: true,
    });
    broker = createDesktopSecretBroker(runtime.childProcess.stdio[3], {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptString(value),
      decrypt: (value) => safeStorage.decryptString(value),
    });
    await wait(async () => (await broker.action("status")).available);
    if (phase === "encrypt") {
      const status = await broker.action("activate");
      assert.equal(status.error, null);
      assert.equal(status.mode, "encrypted");
    }
    await wait(() => runtime.logs.text().includes('"kind":"verified"'));
    if (phase === "restart") {
      broker.availability(false);
      await wait(() => runtime.logs.text().includes('"kind":"locked"'));
      broker.availability(true);
      await wait(() => runtime.logs.text().includes('"kind":"unlocked"'));
    }
    console.log(JSON.stringify({ phase, ok: true }));
  })
  .catch(() => {
    console.error("Native secret smoke failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    broker?.close();
    await runtime?.stop({
      signal: "SIGTERM",
      timeoutMs: 3000,
      killSignal: "SIGKILL",
      killTimeoutMs: 1000,
    });
    app.exit(process.exitCode ?? 0);
  });
