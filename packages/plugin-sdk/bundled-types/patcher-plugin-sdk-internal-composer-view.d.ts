// Portable type declarations for `@patcher/plugin-sdk`. Unpublished Patcher
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @patcher/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the Patcher repo
// and read the real source: https://github.com/laruss/patcher-browser

declare function isComposerDraftEmpty(text: string, attachmentCount: number): boolean;

export { isComposerDraftEmpty };
