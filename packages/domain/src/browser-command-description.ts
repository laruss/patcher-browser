/**
 * One browser command as a line a person can read back.
 *
 * It was a private function of the app's trace recorder until two things
 * rendered a command instead of one. The trace is a file a caller asks for and
 * takes away; the `browser-driving` signal is what the server tells the app's
 * *other* windows while somebody drives, and a window that is not performing
 * the command never sees the command. So the rendering moved to where both can
 * reach it, and the two say the same words about the same command — which is
 * the point, since a person may read one of them in a window and the other in
 * a trace and has no reason to expect two vocabularies.
 *
 * **Keys are named and their values are not.** A cookie write is `cookies-set
 * 3`, a `localStorage` write names the items it touched and none of their
 * contents. The exception is text typed into the page, which is kept: a record
 * that will not say what was filled in is not a record of what happened, and
 * the audience is this install's own windows and the caller's own trace, not a
 * third party.
 */

import {
  BROWSER_COMMAND_MAX_TRACE_DETAIL_LENGTH,
  type BrowserCommand,
  type BrowserInteraction,
  type BrowserScrollTarget,
} from "./browser-control.js";

function describeScrollTarget(target: BrowserScrollTarget): string {
  switch (target.kind) {
    case "by":
      return `by ${target.pixels}`;
    case "element":
      return `${target.ref} into view`;
    default:
      return target.kind;
  }
}

function describeInteraction(interaction: BrowserInteraction): string {
  switch (interaction.action) {
    case "click":
      return `click ${interaction.ref}${
        interaction.button === "left" ? "" : ` (${interaction.button})`
      }${interaction.clickCount === 2 ? " x2" : ""}`;
    case "hover":
      return `hover ${interaction.ref}`;
    case "drag":
      return `drag ${interaction.ref} onto ${interaction.targetRef}`;
    case "fill":
      return `fill ${interaction.ref} ${JSON.stringify(interaction.text)}`;
    case "type":
      return `type ${interaction.ref} ${JSON.stringify(interaction.text)}`;
    case "press":
      return `press ${interaction.key}${
        interaction.ref === null ? "" : ` on ${interaction.ref}`
      }`;
    case "select":
      return `select ${interaction.ref} ${interaction.values.join(", ")}`;
    case "check":
      return `${interaction.checked ? "check" : "uncheck"} ${interaction.ref}`;
    case "upload":
      return `upload ${interaction.ref} ${interaction.paths.join(", ")}`;
    default:
      return `resize ${interaction.width}x${interaction.height}`;
  }
}

/**
 * One command as a line someone can read back.
 *
 * Rendered rather than serialized, because the JSON of a `state.load` is a set
 * of the user's cookies and a trace is a file people save and send each other.
 * So keys are named and their values are not — while what was typed into a form
 * field is kept, since a log that will not say what was filled in is not a log
 * of what happened.
 *
 * Private, because every caller wants the line a record keeps and would have to
 * remember to cut it: {@link browserCommandRecordDetail} is the one entry.
 */
function describeBrowserCommand(command: BrowserCommand): string {
  switch (command.type) {
    case "tabs.open":
      return command.url ?? "new tab";
    case "tabs.close":
    case "tabs.activate":
      return command.tabId;
    case "page.handle_dialog":
      return command.accept ? "accept" : "dismiss";
    // Only when it was scoped. "Read the page" and "read this element" are
    // different steps, and the second one attached a debugger to do it.
    case "page.get_text":
      return command.selector === null ? "" : `in ${command.selector}`;
    case "page.interact":
      return describeInteraction(command.interaction);
    case "page.scroll":
      return describeScrollTarget(command.target);
    case "page.observe":
      return command.observation.kind;
    case "page.storage": {
      const operation = command.operation;
      switch (operation.kind) {
        case "cookies-set":
          return `cookies-set ${operation.cookies.length}`;
        case "cookies-clear":
          return "cookies-clear";
        case "items-get":
          return `items-get ${operation.area}`;
        case "items-set":
          return `items-set ${operation.area} ${operation.items
            .map((item) => item.name)
            .join(", ")}`;
        case "items-clear":
          return `items-clear ${operation.area}`;
        default:
          return operation.kind;
      }
    }
    case "page.control": {
      const operation = command.operation;
      switch (operation.kind) {
        case "mouse-move":
          return `mouse-move ${operation.x},${operation.y}`;
        case "mouse-button":
          return `mouse-${operation.down ? "down" : "up"} ${operation.button}`;
        case "mouse-wheel":
          return `mouse-wheel ${operation.deltaX},${operation.deltaY}`;
        case "evaluate":
          return `evaluate ${operation.expression}`;
        case "route-set":
          return `route ${operation.route.pattern}`;
        case "route-clear":
          return `unroute ${operation.pattern ?? "all"}`;
        case "offline":
          return `offline ${operation.offline}`;
        default:
          return operation.kind;
      }
    }
    case "navigation.open":
      return command.url;
    default:
      return "";
  }
}

/**
 * The same line, cut to what a record keeps.
 *
 * Here rather than at each call site because there are now two records with
 * one budget between them: a trace step and the wire signal's `detail`, whose
 * schema holds it to this length. A renderer that truncated on its own would
 * hide the cap from the trace, and two call sites slicing with the same
 * constant is one of them forgetting.
 */
export function browserCommandRecordDetail(command: BrowserCommand): string {
  return describeBrowserCommand(command).slice(
    0,
    BROWSER_COMMAND_MAX_TRACE_DETAIL_LENGTH,
  );
}
