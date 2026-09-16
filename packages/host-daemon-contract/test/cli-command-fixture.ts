/**
 * The wire fixture for the two `patcher`-on-PATH commands (#143).
 *
 * Out here rather than beside the other fixtures because `contract.test.ts` is
 * held at its size by `eslint.max-lines.mjs`, and the rule for a pinned file is
 * that new code goes in a new module. Both commands answer with the same
 * result shape, so one value stands for both.
 */
export const CLI_COMMAND_RESULT = {
  state: "installed",
  linkPath: "/home/user/.local/bin/patcher",
  existingPath: "/home/user/.local/bin/patcher",
  existingTarget: "/home/user/.patcher/bin/patcher",
  shimDirectory: "/home/user/.patcher/bin",
  reason: null,
  message: null,
  changed: true,
};
