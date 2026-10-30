import { expect, it, vi } from "vitest";
import { fetchPasswordManagerMenuEnabled } from "../src/password-manager-menu-state.js";

const manager = {
  id: "password-manager",
  enabled: true,
  source: "builtin:password-manager",
  provenance: "builtin",
};
function args(plugins: unknown[]) {
  return {
    serverUrl: "http://127.0.0.1:38986/old/path?ignored=1",
    headers: { "x-patcher-app-key": "fixture" },
    fetchImpl: vi.fn(
      async () => new Response(JSON.stringify({ plugins })),
    ) as unknown as typeof fetch,
  };
}
it("reads the enabled builtin setting without depending on vault or Keychain availability", async () => {
  const request = args([manager]);
  await expect(fetchPasswordManagerMenuEnabled(request)).resolves.toBe(true);
  expect(request.fetchImpl).toHaveBeenCalledWith(
    "http://127.0.0.1:38986/api/v1/plugins",
    { headers: request.headers },
  );
});
it.each([
  [],
  [{ ...manager, enabled: false }],
  [{ ...manager, source: "path:/tmp/impostor", provenance: "direct" }],
])(
  "hides the menu for a missing, disabled or replaced manager (%j)",
  async (...plugins) => {
    await expect(fetchPasswordManagerMenuEnabled(args(plugins))).resolves.toBe(
      false,
    );
  },
);
it("reports a disconnected server instead of treating it as a disabled plugin", async () => {
  const request = args([]);
  request.fetchImpl = vi.fn(
    async () => new Response("", { status: 503 }),
  ) as unknown as typeof fetch;
  await expect(fetchPasswordManagerMenuEnabled(request)).rejects.toThrow(
    "HTTP 503",
  );
});
