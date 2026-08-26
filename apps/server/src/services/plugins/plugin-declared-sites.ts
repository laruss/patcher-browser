/**
 * The one rule that decides where a plugin's page contributions may run.
 *
 * A module of its own because it is now read from both sides of the process
 * boundary and two copies of it would drift. `plugin-api.ts` applies it where a
 * plugin calls `registerPageScript`, which is what gives an under-declared
 * plugin's author a fixable error at the call site;
 * `plugin-registration-guard.ts` applies it again to what a plugin process
 * *reports* having registered, which is what makes it enforcement rather than a
 * courtesy — the copy that runs in the plugin's own process is a copy the
 * plugin can decline to run.
 *
 * A leaf on purpose: every plugin process loads `plugin-api.ts`, and the host
 * needs this rule without loading that file's 3000 lines of registration
 * surface.
 */

/**
 * The site patterns one page contribution may use, or a refusal naming the list
 * it has to pick from.
 *
 * Shared by page styles and page scripts because this is the rule the whole
 * consent model rests on: `matches` must be a **member** of what the manifest
 * declared, verbatim. Not a subset by glob — "is this pattern inside that one"
 * is a question with no answer worth trusting code on a signed-in page to, and
 * the manifest is the line a human read before installing.
 */
export function resolveDeclaredMatches(args: {
  kind: string;
  id: string;
  matches: unknown;
  maxMatches: number;
  declared: readonly string[];
  pluginId: string;
}): string[] {
  const { kind, id, matches, maxMatches, declared, pluginId } = args;
  if (
    !Array.isArray(matches) ||
    matches.length === 0 ||
    matches.length > maxMatches
  ) {
    throw new Error(
      `${kind} "${id}" must match between 1 and ${maxMatches} of the plugin's declared sites`,
    );
  }
  for (const pattern of matches) {
    if (typeof pattern !== "string" || !declared.includes(pattern)) {
      throw new Error(
        `${kind} "${id}" matches ${JSON.stringify(pattern)}, which plugin "${pluginId}" does not declare in "patcher.sites". ` +
          (declared.length === 0
            ? `That list is empty — add the site there, then run \`patcher plugin reload ${pluginId}\`.`
            : `It declares: ${declared.join(", ")}.`),
      );
    }
  }
  return [...(matches as string[])];
}
