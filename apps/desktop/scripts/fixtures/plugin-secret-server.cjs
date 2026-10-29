const { Socket } = require("node:net");
const { join } = require("node:path");
const { mkdir, writeFile } = require("node:fs/promises");
const assert = require("node:assert/strict");
const root = process.env.PATCHER_SECRET_SMOKE_ROOT;
const phase = process.env.PATCHER_SECRET_SMOKE_PHASE;
const { createDesktopSecretStorage } = require(join(root, "storage.js"));
const sentinel = "native-sentinel-秘密\n";
let storage;
let verified = false;
let locked = false;
let unlocked = false;
let checking = false;
async function start() {
  const dataDir = join(root, "data");
  if (phase === "encrypt") {
    const dir = join(dataDir, "plugins", "fixture", "secrets");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "token"), sentinel);
  }
  storage = createDesktopSecretStorage(
    dataDir,
    new Socket({ fd: 3, readable: true, writable: true }),
  );
  assert.equal(JSON.stringify(process.env).includes(sentinel), false);
  const timer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const status = await storage.store.status();
      if (status.mode !== "encrypted") return;
      if (!verified && status.error === null) {
        assert.equal(
          await storage.store.forPlugin("fixture").get("token"),
          sentinel,
        );
        verified = true;
        console.log(JSON.stringify({ kind: "verified" }));
      } else if (verified && !locked && status.error === "locked") {
        await assert.rejects(
          storage.store.forPlugin("fixture").get("token"),
          (error) => error.code === "locked",
        );
        assert.equal(
          await storage.store.forPlugin("fixture").has("token"),
          true,
        );
        locked = true;
        console.log(JSON.stringify({ kind: "locked" }));
      } else if (locked && !unlocked && status.error === null) {
        assert.equal(
          await storage.store.forPlugin("fixture").get("token"),
          sentinel,
        );
        unlocked = true;
        console.log(JSON.stringify({ kind: "unlocked" }));
      }
    } catch {
      console.error("Secret server smoke failed");
      clearInterval(timer);
      storage.close();
      process.exit(1);
    } finally {
      checking = false;
    }
  }, 25);
  process.once("SIGTERM", () => {
    clearInterval(timer);
    storage.close();
    process.exit(0);
  });
}
start().catch(() => {
  console.error("Secret server smoke startup failed");
  process.exit(1);
});
