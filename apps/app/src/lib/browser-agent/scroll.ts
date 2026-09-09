/**
 * What a `page.scroll` actually runs in the page.
 *
 * These lived in `plugins/browser-tools/src/cli.ts` while scrolling was four
 * fixed expressions the CLI sent down `control.evaluate`. #115 moved the price
 * onto a command of its own, and the expressions had to move with it: a scroll
 * whose expression the caller supplies is exactly the thing `page.inject`
 * exists to charge for, so the only way the command can cost `page.interact` is
 * for the code to be ours, decided here from a target the schema has already
 * checked. Nothing a caller sends is spliced into a string except an integer.
 *
 * The shell wire has no scroll of its own — it is frozen — so what leaves the
 * app is an ordinary `evaluate`, exactly as it was before. What changed is who
 * writes the expression and what the command costs, not how it travels.
 *
 * Each expression answers with `[top, height, viewport, before]`, so a caller
 * learns whether the page actually moved — which on an infinite feed is the
 * difference between "keep going" and "this is the end".
 */
import type { BrowserScrollTarget } from "@patcher/domain";

/**
 * `scrollTop =` rather than `scrollBy`: a page with `scroll-behavior: smooth`
 * animates the second one, and the position read back would be where the page
 * was on its way rather than where it is going.
 */
function scrollTo(offset: string): string {
  return `() => {
  const el = document.scrollingElement ?? document.body;
  const before = el.scrollTop;
  el.scrollTop = ${offset};
  return [el.scrollTop, el.scrollHeight, window.innerHeight, before];
}`;
}

/** The expression for one target, and the only place a target becomes code. */
export function browserScrollExpression(target: BrowserScrollTarget): string {
  switch (target.kind) {
    case "top":
      return scrollTo("0");
    case "bottom":
      return scrollTo("el.scrollHeight");
    case "by":
      return scrollTo(`el.scrollTop + ${target.pixels}`);
    case "page":
      // One viewport less a tenth, so the line that was at the bottom is still
      // on screen at the top — the overlap Page Down gives a reader, and what
      // keeps a paragraph from falling between two scrolls.
      return scrollTo("el.scrollTop + Math.round(window.innerHeight * 0.9)");
    case "element":
      // The element's own scroll, so the page ends up wherever the browser has
      // to put it; the tuple is read back afterwards, and `before` is the same
      // number because nothing here knows where the page started.
      return `(element) => {
  element.scrollIntoView({ block: "center", inline: "nearest" });
  const el = document.scrollingElement ?? document.body;
  return [el.scrollTop, el.scrollHeight, window.innerHeight, el.scrollTop];
}`;
  }
}
