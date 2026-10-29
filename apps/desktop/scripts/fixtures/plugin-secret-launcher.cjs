const { Socket } = require("node:net");
const { join } = require("node:path");
const root = process.env.PATCHER_SECRET_SMOKE_ROOT;
const { DesktopSecretRelay } = require(join(root, "relay.js"));
const { spawnManagedProcess } = require(join(root, "spawn.js"));
const relay = new DesktopSecretRelay(
  new Socket({ fd: 3, readable: true, writable: true }),
);
const server = spawnManagedProcess({
  command: process.execPath,
  args: [join(__dirname, "plugin-secret-server.cjs")],
  env: process.env,
  outputBuffer: { handler: (chunk) => process.stdout.write(chunk) },
  secretRelay: relay,
});
server.once("exit", (code) => {
  relay.close();
  process.exit(code ?? 1);
});
process.once("SIGTERM", () => server.kill("SIGTERM"));
