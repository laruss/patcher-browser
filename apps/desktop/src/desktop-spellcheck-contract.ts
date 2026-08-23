export const PATCHER_DESKTOP_SPELLCHECK_GLOBAL_NAME =
  "__patcherDesktopSpellcheck";

export interface PatcherDesktopSpellcheckCorrectionContext {
  dictionarySuggestions: string[];
  misspelledWord: string;
}

export interface PatcherDesktopSpellcheckApi {
  getCorrectionContext(
    word: string,
  ): PatcherDesktopSpellcheckCorrectionContext | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parsePatcherDesktopSpellcheckCorrectionContext(
  value: unknown,
): PatcherDesktopSpellcheckCorrectionContext | null {
  if (!isRecord(value)) {
    return null;
  }
  const { dictionarySuggestions, misspelledWord } = value;
  if (
    typeof misspelledWord !== "string" ||
    !Array.isArray(dictionarySuggestions) ||
    dictionarySuggestions.some((suggestion) => typeof suggestion !== "string")
  ) {
    return null;
  }
  return {
    dictionarySuggestions,
    misspelledWord,
  };
}

export function buildPatcherDesktopSpellcheckLookupScript(
  word: string,
): string {
  return `globalThis[${JSON.stringify(PATCHER_DESKTOP_SPELLCHECK_GLOBAL_NAME)}]?.getCorrectionContext(${JSON.stringify(word)}) ?? null`;
}
