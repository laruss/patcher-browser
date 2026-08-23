import {
  defineWorkspaceTestConfig,
  findIsolationRequiringTests,
} from "../../vitest.shared.js";

const exclude = ["dist/**", "node_modules/**", "src/integration*.test.ts"];
const isolationTests = findIsolationRequiringTests(__dirname, ["src"]);

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    projects: [
      {
        extends: true,
        test: {
          name: "@patcher/agent-runtime",
          include: ["src/**/*.test.ts"],
          exclude: [...exclude, ...isolationTests],
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          name: "@patcher/agent-runtime:isolated",
          include: isolationTests,
          exclude,
        },
      },
    ],
  },
});
