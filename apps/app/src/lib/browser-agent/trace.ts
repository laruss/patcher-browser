/**
 * The log behind `tracing-start` … `tracing-stop`.
 *
 * It lives here, in the app, rather than in the shell — which is the one
 * decision in it worth arguing about. The shell sees more of the browser and
 * has the pixels, but it cannot tell an agent's command from a person's: a
 * `navigate` arriving there looks the same whether it came from a tool call or
 * from the omnibox, and a log of "what the agent did" that also records what the
 * user did is not that log. This function is the only place a browser command
 * exists as a command, so this is where the trace is kept.
 *
 * What that costs, stated rather than discovered: tab bookkeeping an agent does
 * is recorded, page loads a *page* starts are not, and neither is anything the
 * user does in the same browser while the trace runs.
 */

import {
  BROWSER_COMMAND_MAX_TRACE_DETAIL_LENGTH,
  BROWSER_COMMAND_MAX_TRACE_IMAGE_BASE64_LENGTH,
  BROWSER_COMMAND_MAX_TRACE_STEPS,
  BROWSER_COMMAND_MAX_VIDEO_FRAME_BASE64_LENGTH,
  type BrowserCommand,
  type BrowserCommandOutcome,
  type BrowserInteraction,
  type BrowserTraceStep,
} from "@patcher/domain";

/**
 * Step images are JPEG at this quality, and there is no knob: a trace of 200
 * steps is 200 screenshots, so the setting that decides whether a trace fits in
 * its budget is not one to hand to a caller who cannot see the budget.
 */
export const BROWSER_TRACE_SCREENSHOT_QUALITY = 50;

export interface BrowserTrace {
  steps: BrowserTraceStep[];
  droppedSteps: number;
  droppedImages: number;
  durationMs: number;
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
 */
export function describeBrowserCommand(command: BrowserCommand): string {
  switch (command.type) {
    case "tabs.open":
      return command.url ?? "new tab";
    case "tabs.close":
    case "tabs.activate":
      return command.tabId;
    case "page.handle_dialog":
      return command.accept ? "accept" : "dismiss";
    case "page.interact":
      return describeInteraction(command.interaction);
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
 * Whether a step is worth a picture.
 *
 * Reads are listed and everything else gets one, rather than the other way
 * round: a command that is not a plain read may have changed the page, and a
 * trace that skipped the picture would be a trace of the moment nothing
 * happened.
 */
export function browserCommandChangesPage(command: BrowserCommand): boolean {
  switch (command.type) {
    case "tabs.list":
    case "page.get_url":
    case "page.get_title":
    case "page.get_text":
    case "page.get_selection":
    case "page.snapshot":
    case "page.observe":
    case "page.record":
      return false;
    default:
      return true;
  }
}

export class BrowserTraceRecorder {
  private steps: BrowserTraceStep[] = [];
  private startedAt: number | null = null;
  private screenshots = false;
  private droppedSteps = 0;
  private droppedImages = 0;
  private imageLength = 0;
  private seq = 0;

  get active(): boolean {
    return this.startedAt !== null;
  }

  get wantsScreenshots(): boolean {
    return this.startedAt !== null && this.screenshots;
  }

  /** False when one is already running: a trace nobody stopped is not restarted. */
  start(now: number, screenshots: boolean): boolean {
    if (this.startedAt !== null) {
      return false;
    }
    this.steps = [];
    this.startedAt = now;
    this.screenshots = screenshots;
    this.droppedSteps = 0;
    this.droppedImages = 0;
    this.imageLength = 0;
    this.seq = 0;
    return true;
  }

  record(
    command: BrowserCommand,
    outcome: BrowserCommandOutcome,
    image: string | null,
    now: number,
  ): void {
    const startedAt = this.startedAt;
    if (startedAt === null) {
      return;
    }
    this.seq += 1;
    if (this.steps.length >= BROWSER_COMMAND_MAX_TRACE_STEPS) {
      // The oldest steps are the ones a reviewer already has context for, and
      // dropping the newest would hide the failure the trace was taken for.
      this.steps.shift();
      this.droppedSteps += 1;
    }
    this.steps.push({
      seq: this.seq,
      at: Math.max(0, Math.round(now - startedAt)),
      command: command.type,
      detail: describeBrowserCommand(command).slice(
        0,
        BROWSER_COMMAND_MAX_TRACE_DETAIL_LENGTH,
      ),
      ok: outcome.ok,
      error: outcome.ok ? null : outcome.code,
      image: this.keepImage(image),
    });
  }

  stop(now: number): BrowserTrace | null {
    const startedAt = this.startedAt;
    if (startedAt === null) {
      return null;
    }
    const trace: BrowserTrace = {
      steps: this.steps,
      droppedSteps: this.droppedSteps,
      droppedImages: this.droppedImages,
      durationMs: Math.max(0, Math.round(now - startedAt)),
    };
    this.steps = [];
    this.startedAt = null;
    this.screenshots = false;
    return trace;
  }

  /**
   * The images are what makes a trace large, so they are budgeted separately
   * from the steps: past the budget the log keeps recording without them rather
   * than the recording ending or the reply growing past what the bridge carries.
   */
  private keepImage(image: string | null): string | null {
    if (image === null) {
      return null;
    }
    if (
      image.length > BROWSER_COMMAND_MAX_VIDEO_FRAME_BASE64_LENGTH ||
      this.imageLength + image.length >
        BROWSER_COMMAND_MAX_TRACE_IMAGE_BASE64_LENGTH
    ) {
      this.droppedImages += 1;
      return null;
    }
    this.imageLength += image.length;
    return image;
  }
}
