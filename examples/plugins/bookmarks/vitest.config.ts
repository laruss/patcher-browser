import { defineWorkspaceTestConfig } from "../../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "patcher-plugin-bookmarks",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
