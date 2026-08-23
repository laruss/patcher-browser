import {
  defineWorkspaceTestConfig,
  findIsolationRequiringTests,
} from "../../vitest.shared.js";

const isolationTests = findIsolationRequiringTests(__dirname, ["src", "test"]);

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    env: {
      PATCHER_DATA_DIR: "/tmp/patcher-server-test",
      PATCHER_SERVER_PORT: "49161",
      PATCHER_HOST_DAEMON_PORT: "49162",
    },
    projects: [
      {
        extends: true,
        test: {
          name: "@patcher/server",
          include: ["src/**/*.test.ts", "test/**/*.test.ts"],
          exclude: ["dist/**", "node_modules/**", ...isolationTests],
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          name: "@patcher/server:isolated",
          include: isolationTests,
        },
      },
    ],
  },
});
