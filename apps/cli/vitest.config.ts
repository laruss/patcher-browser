import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "@patcher/cli",
    exclude: ["dist/**", "node_modules/**"],
    env: {
      PATCHER_SERVER_URL: "http://127.0.0.1:49161",
      PATCHER_HOST_DAEMON_PORT: "49162",
      // A shell that `patcher agent-access grant` handed a key to would put
      // `mcp-serve` in grant mode and have `cliFetch` present that grant, so
      // the suite would be about the shell rather than the code. The tests
      // that are about a grant set one themselves.
      PATCHER_AGENT_KEY: "",
      PATCHER_AGENT_KEY_FILE: "",
    },
  },
});
