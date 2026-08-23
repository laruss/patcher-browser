/**
 * One registration of every kind that can cross a process boundary, so the
 * in-process handle and the remote one can be compared member for member.
 *
 * Including `patcher.rpc.register` and `patcher.agents.registerTool`, whose zod schemas
 * are the point: a validator is a function and never crosses, so the check has
 * to run where the handler is. Comparing the two placements on the *same* zod
 * schema is what says it does — and says it the same way, down to the issues.
 */
import { z } from "zod";

export default function plugin(patcher: any): void {
  patcher.rpc.register(
    {
      greet: {
        input: z.object({ who: z.string().min(2) }),
        output: z.object({ text: z.string() }),
      },
    },
    { greet: ({ who }: { who: string }) => ({ text: `hi ${who}` }) },
  );

  patcher.agents.registerTool({
    name: "shout_tool",
    description: "Uppercases a word.",
    instructions: "Use it to shout.",
    // `.default()` on purpose: it proves the *parsed* value reaches execute,
    // rather than the raw arguments passing through untouched.
    parameters: z.object({ word: z.string(), loud: z.boolean().default(true) }),
    execute: ({ word, loud }: { word: string; loud: boolean }) =>
      loud ? word.toUpperCase() : word,
  });

  patcher.http.route("GET", "/ping", () => Response.json({ pong: true }));

  patcher.background.service("worker", {
    start: (signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve());
      }),
  });

  patcher.background.schedule("nightly", "0 3 * * *", () => {
    calls.push("schedule");
  });

  patcher.cli.register({
    name: "full",
    summary: "A fixture command.",
    commands: [{ name: "go", summary: "Go.", usage: "full go" }],
    run: (argv: string[]) => ({
      exitCode: 0,
      stdout: argv.join(","),
      stderr: "",
    }),
  });

  patcher.agents.configure(() => ({ tools: [], skills: [] }));
  patcher.agents.contributeInstructions(
    (ctx: { threadId: string }) => `instructions for ${ctx.threadId}`,
  );

  patcher.ui.registerMentionProvider({
    id: "people",
    label: "People",
    search: (ctx: { query: string }) => [
      { id: `p-${ctx.query}`, title: ctx.query.toUpperCase() },
    ],
    resolve: (itemId: string) => ({ context: `resolved ${itemId}` }),
  });

  patcher.ui.registerKeybinding({
    command: "browser.newTab",
    shortcut: { key: "t", mod: true },
  });

  patcher.browser.registerOmniboxProvider({
    id: "search",
    label: "Search",
    suggest: (ctx: { query: string }) => [
      { id: "s1", title: `find ${ctx.query}` },
    ],
    run: (itemId: string) => ({ kind: "navigate", url: `https://x/${itemId}` }),
  });

  patcher.browser.registerContextMenuItem({
    id: "shout",
    title: "Shout",
    run: (ctx: { selectionText: string | null }) =>
      (ctx.selectionText ?? "").toUpperCase(),
  });

  patcher.browser.registerFindAction({
    id: "look",
    title: "Look up",
    run: (ctx: { query: string }) => `looking for ${ctx.query}`,
  });

  patcher.browser.registerTabAction({
    id: "file",
    title: "File this tab",
    run: (ctx: { url: string | null }) =>
      `filing ${ctx.url ?? "a Patcher screen"}`,
  });

  patcher.browser.registerSiteInfoProvider({
    id: "facts",
    label: "Facts",
    describe: (ctx: { host: string }) => [{ label: "Host", value: ctx.host }],
  });

  patcher.browser.registerSearchEngine({
    id: "kagi",
    name: "Kagi",
    urlTemplate: "https://kagi.com/search?q=%s",
  });

  patcher.browser.registerPageStyle({
    id: "declutter",
    matches: ["https://example.test/**"],
    css: ".ad { display: none !important }",
  });

  patcher.browser.registerPageScript({
    id: "toolbar",
    matches: ["https://example.test/**"],
    code: "patcher.ready(function () { document.title = 'seen'; });",
  });

  patcher.browser.registerAuthProvider(() => null);
  patcher.browser.registerAuthProvider((challenge: { host: string }) => ({
    username: "u",
    password: challenge.host,
  }));

  patcher.browser.registerPdfTextProvider(() => null);
  patcher.browser.registerPdfTextProvider(() => "page text");

  patcher.browser.registerDownloadHandler(() => {
    calls.push("download");
  });

  patcher.events.on("thread.created", () => {
    calls.push("thread.created");
  });

  const settings = patcher.settings.define({
    token: { type: "string", label: "Token", default: "" },
  });
  settings.onChange(() => {
    calls.push("settings");
  });

  patcher.onDispose(() => {
    calls.push("dispose");
  });
}

/** Observable from the in-process build; the remote one reports over the wire. */
export const calls: string[] = [];
