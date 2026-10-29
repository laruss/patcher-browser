import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "patcher-plugin-password-manager",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
    environmentOptions: { jsdom: { url: "https://example.test/login" } },
  },
});
