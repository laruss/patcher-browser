import type { BrowserInteraction } from "@patcher/domain";

/**
 * A ref that carries the snapshot it came from.
 *
 * A snapshot hands out `e1`, `e2`, … and a generation; acting on one takes both,
 * and the second half was optional — `--generation`, null by default, "skip the
 * check". So the guard against acting on an element that has moved was off
 * unless a caller thought to turn it on, and the case it guards is exactly the
 * one a caller cannot see: another caller snapshots the same tab, `e2` is now a
 * different element, and the click lands on it.
 *
 * So the snapshot hands out `e2@6` instead, and the app splits that back into a
 * ref and a generation before the shell sees it. Three things follow, and each
 * is why this shape was chosen over making `generation` required:
 *
 * - **The check is on by default**, because the ref a caller copies out of the
 *   snapshot is the ref that carries its generation. Nothing to remember.
 * - **A bare `e2` still works**, unchecked, exactly as before — an agent
 *   holding refs from before this change, or one that strips the suffix, is not
 *   broken by it.
 * - **The shell's wire never sees an `@`.** That contract is frozen
 *   (bb-migration.md, invariant 2) and its ref pattern is `^e[1-9][0-9]{0,5}$`;
 *   translating here means an older shell keeps working, which is the same
 *   reason the app already translates sizes and selectors at this boundary.
 */

const REF_WITH_GENERATION = /^(e[1-9][0-9]{0,5})@([0-9]{1,9})$/u;

export interface SplitBrowserRef {
  /** The ref as the shell knows it. */
  ref: string;
  /** The snapshot it was minted by, or null when the caller did not say. */
  generation: number | null;
}

export function splitBrowserRef(ref: string): SplitBrowserRef {
  const matched = REF_WITH_GENERATION.exec(ref);
  if (matched === null) {
    return { ref, generation: null };
  }
  return { ref: matched[1] ?? ref, generation: Number(matched[2]) };
}

/**
 * Which snapshot a command's refs belong to.
 *
 * Refuses rather than guesses when the answers disagree — two refs from
 * different snapshots, or a ref and a `--generation` that do not match. Both
 * mean the caller is holding two ideas of the page at once, and picking one for
 * it would act on an element it did not mean.
 */
export function browserRefGeneration({
  declared,
  refs,
}: {
  declared: number | null;
  refs: readonly (string | null)[];
}): { ok: true; generation: number | null } | { ok: false; message: string } {
  let generation: number | null = null;
  for (const ref of refs) {
    if (ref === null) continue;
    const split = splitBrowserRef(ref);
    if (split.generation === null) continue;
    if (generation !== null && generation !== split.generation) {
      return {
        ok: false,
        message: `Those refs come from different snapshots (${generation} and ${split.generation}). Take one snapshot and use the refs it gives you.`,
      };
    }
    generation = split.generation;
  }
  if (declared !== null && generation !== null && declared !== generation) {
    return {
      ok: false,
      message: `That ref is from snapshot ${generation} and the generation passed with it is ${declared}. Pass one or the other.`,
    };
  }
  return { ok: true, generation: generation ?? declared };
}

/** Every ref in an interaction, in the order they appear. */
export function browserInteractionRefs(
  interaction: BrowserInteraction,
): readonly (string | null)[] {
  if ("targetRef" in interaction) {
    return [interaction.ref, interaction.targetRef];
  }
  if ("ref" in interaction) {
    return [interaction.ref];
  }
  return [];
}

/** The same interaction with refs the shell's frozen wire will accept. */
export function withBareBrowserRefs(
  interaction: BrowserInteraction,
): BrowserInteraction {
  if ("targetRef" in interaction) {
    return {
      ...interaction,
      ref: splitBrowserRef(interaction.ref).ref,
      targetRef: splitBrowserRef(interaction.targetRef).ref,
    };
  }
  if ("ref" in interaction && interaction.ref !== null) {
    return { ...interaction, ref: splitBrowserRef(interaction.ref).ref };
  }
  return interaction;
}

/**
 * Annotates a snapshot's `[ref=eN]` markers with the generation they belong to.
 *
 * On the text rather than in the shell, for the reason in the module docstring:
 * the shell's wire is frozen and its ref pattern would refuse `e2@6` on the way
 * back. The marker is the whole match — `[ref=` up to `]` — so nothing else in
 * a page's own text can be mistaken for one.
 */
export function annotateSnapshotRefs(
  snapshot: string,
  generation: number,
): string {
  return snapshot.replace(
    /\[ref=(e[1-9][0-9]{0,5})\]/gu,
    `[ref=$1@${generation}]`,
  );
}
