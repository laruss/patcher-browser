import tsParser from "@typescript-eslint/parser";
import { NOT_SOURCE, fileSizeConfigs } from "./eslint.max-lines.mjs";

/**
 * The file-size rule, and nothing else, over the whole repository.
 *
 * Its own config because the rest of `eslint.config.mjs` cannot run repository
 * wide yet — outside `apps/app`, which is the only package with a lint task, a
 * full run reports 79 errors in 46 files that predate it (measured 2026-09-03).
 * That is work of its own, and until it is done a file-size limit that only
 * covered one app would miss every file this rule exists for.
 *
 * Run by `bun run lint:file-size`, in CI's Checks job, with
 * `--no-config-lookup` so the root config stays out of it and `--no-inline-config`
 * so an `eslint-disable` naming a rule this run does not register is not itself
 * an error. Both flags are in the script rather than here: as a config option,
 * `noInlineConfig` makes ESLint report every directive it ignored, which is 37
 * warnings of nothing.
 *
 * The flag has a second effect worth having: the limit cannot be switched off
 * from inside the file it applies to. The only way to relax it is a pin in
 * `eslint.max-lines.mjs`, which is a diff in a shared file that a reviewer sees.
 */
export default [
  { ignores: NOT_SOURCE },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
  },
  ...fileSizeConfigs,
];
