/**
 * Turning Chromium's accessibility tree into something an agent can act on.
 *
 * This is the primitive the whole interaction set rests on. Page text cannot
 * address anything — "click the Submit button" has no referent in a wall of
 * `innerText` — and asking a model to invent CSS selectors is the brittle path
 * that accessibility snapshots exist to replace. So every interactive node gets
 * a short ref, and later commands name the ref rather than describing the
 * element.
 *
 * The output format follows Playwright's, deliberately: it is compact, it reads
 * well to a model, and matching it means agents already trained on that shape
 * need no translation.
 *
 *     - heading "todos" [level=1]
 *     - textbox "What needs to be done?" [ref=e5]
 *     - listitem:
 *       - checkbox "Toggle Todo" [ref=e10] [checked]
 *       - text: "Buy groceries"
 */

/** Cap on nodes rendered, so one enormous page cannot fill an agent's context. */
export const PATCHER_SNAPSHOT_MAX_NODES = 2_000;
/** Cap on the rendered text, mirroring how page reads are bounded. */
export const PATCHER_SNAPSHOT_MAX_LENGTH = 65_536;

/** A CDP `AXValue`; only `value` is ever read here. */
interface AxValue {
  type?: string;
  value?: unknown;
}

interface AxProperty {
  name?: string;
  value?: AxValue;
}

/** A CDP `AXNode`, narrowed to the fields this module uses. */
export interface AxNode {
  nodeId?: string;
  ignored?: boolean;
  role?: AxValue;
  name?: AxValue;
  value?: AxValue;
  properties?: AxProperty[];
  childIds?: string[];
  backendDOMNodeId?: number;
}

/**
 * Roles that get a ref. `focusable` catches most of these anyway, but a role
 * list is what keeps a `<div tabindex=0>` wrapper from taking a ref that belongs
 * to the control inside it, and what makes the set reviewable.
 */
const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "colorwell",
  "combobox",
  "disclosuretriangle",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "scrollbar",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

/** Roles whose text content is the point, rendered as `- text: "…"`. */
const TEXT_ROLES = new Set(["text", "statictext", "inlinetextbox"]);

/** Roles carrying no information a reader or an agent can use. */
const STRUCTURAL_NOISE_ROLES = new Set([
  "generic",
  "none",
  "presentation",
  "inlinetextbox",
]);

function stringValue(value: AxValue | undefined): string {
  return typeof value?.value === "string" ? value.value : "";
}

function propertyMap(node: AxNode): Map<string, unknown> {
  const properties = new Map<string, unknown>();
  for (const property of node.properties ?? []) {
    if (typeof property.name === "string") {
      properties.set(property.name, property.value?.value);
    }
  }
  return properties;
}

function isInteractive(
  role: string,
  properties: Map<string, unknown>,
): boolean {
  if (properties.get("disabled") === true) {
    // Still rendered — an agent should see a disabled control exists — but not
    // addressable, because acting on it can only fail.
    return false;
  }
  return INTERACTIVE_ROLES.has(role) || properties.get("focusable") === true;
}

/**
 * State worth showing. Kept short on purpose: every attribute is tokens spent on
 * every matching node, so this is only what changes what an agent would do.
 */
function describeState(properties: Map<string, unknown>): string[] {
  const parts: string[] = [];
  const level = properties.get("level");
  if (typeof level === "number" && level > 0) {
    parts.push(`level=${level}`);
  }
  const checked = properties.get("checked");
  if (checked === true || checked === "true") {
    parts.push("checked");
  } else if (checked === "mixed") {
    parts.push("checked=mixed");
  }
  const expanded = properties.get("expanded");
  if (expanded === true) {
    parts.push("expanded");
  } else if (expanded === false) {
    parts.push("collapsed");
  }
  if (properties.get("selected") === true) {
    parts.push("selected");
  }
  if (properties.get("disabled") === true) {
    parts.push("disabled");
  }
  if (properties.get("required") === true) {
    parts.push("required");
  }
  return parts;
}

export interface BrowserSnapshotRef {
  ref: string;
  backendNodeId: number;
}

export interface BrowserSnapshot {
  text: string;
  refs: BrowserSnapshotRef[];
  /** True when a cap stopped the walk, so the tree shown is incomplete. */
  truncated: boolean;
}

export interface BuildBrowserSnapshotArgs {
  nodes: readonly AxNode[];
  /** Render this node's subtree instead of the whole document. */
  root?: AxNode;
  maxNodes?: number;
  maxDepth?: number;
  maxLength?: number;
}

/**
 * The accessibility node describing a given DOM element, or null when the tree
 * has none.
 *
 * Null is a real answer rather than an error case: an element inside a
 * `display: none` subtree is not in the accessibility tree at all, and a caller
 * that scoped a snapshot to one deserves to be told that rather than handed the
 * whole page.
 */
export function findBrowserSnapshotRoot(
  nodes: readonly AxNode[],
  backendNodeId: number,
): AxNode | null {
  return (
    nodes.find((node) => node.backendDOMNodeId === backendNodeId) ?? null
  );
}

/**
 * Build the snapshot text and its ref table from a full AX tree.
 *
 * Ignored nodes are skipped but walked through: Chromium marks plenty of
 * wrappers ignored while their descendants are exactly what matters. That is
 * also what makes a scoped snapshot work on the selector people actually
 * write — `#app` usually names a `<div>` the tree calls generic, and what the
 * caller wanted was its contents.
 */
export function buildBrowserSnapshot(
  args: BuildBrowserSnapshotArgs,
): BrowserSnapshot {
  const maxNodes = args.maxNodes ?? PATCHER_SNAPSHOT_MAX_NODES;
  const maxLength = args.maxLength ?? PATCHER_SNAPSHOT_MAX_LENGTH;
  const byId = new Map<string, AxNode>();
  for (const node of args.nodes) {
    if (typeof node.nodeId === "string") {
      byId.set(node.nodeId, node);
    }
  }

  const childIds = new Set<string>();
  for (const node of args.nodes) {
    for (const childId of node.childIds ?? []) {
      childIds.add(childId);
    }
  }
  const roots = args.nodes.filter(
    (node) => typeof node.nodeId === "string" && !childIds.has(node.nodeId),
  );
  // A tree where everything is somebody's child has no root — only reachable via
  // a malformed or cyclic response, but rendering nothing at all would look like
  // an empty page rather than a broken one, so start from the first node.
  const startingPoints =
    args.root !== undefined
      ? [args.root]
      : roots.length > 0
        ? roots
        : args.nodes.slice(0, 1);

  const lines: string[] = [];
  const refs: BrowserSnapshotRef[] = [];
  let rendered = 0;
  let truncated = false;
  let nextRef = 1;
  const seen = new Set<string>();

  function walk(node: AxNode, depth: number): void {
    if (truncated) {
      return;
    }
    const nodeId = node.nodeId;
    // A malformed tree that points back at itself must not spin forever.
    if (typeof nodeId === "string") {
      if (seen.has(nodeId)) {
        return;
      }
      seen.add(nodeId);
    }

    const children = (node.childIds ?? [])
      .map((childId) => byId.get(childId))
      .filter((child): child is AxNode => child !== undefined);

    const role = stringValue(node.role).toLowerCase();
    const properties = propertyMap(node);
    const name = stringValue(node.name).trim();
    const skip =
      node.ignored === true ||
      role.length === 0 ||
      (STRUCTURAL_NOISE_ROLES.has(role) && name.length === 0);

    if (skip) {
      // Descend anyway: the useful content usually hangs off ignored wrappers.
      for (const child of children) {
        walk(child, depth);
      }
      return;
    }

    if (args.maxDepth !== undefined && depth > args.maxDepth) {
      return;
    }
    if (rendered >= maxNodes) {
      truncated = true;
      return;
    }
    rendered += 1;

    const indent = "  ".repeat(depth);
    const isText = TEXT_ROLES.has(role);
    let line: string;

    if (isText) {
      if (name.length === 0) {
        for (const child of children) {
          walk(child, depth);
        }
        return;
      }
      line = `${indent}- text: ${JSON.stringify(name)}`;
    } else {
      const parts = [`${indent}- ${role}`];
      if (name.length > 0) {
        parts.push(` ${JSON.stringify(name)}`);
      }
      if (
        typeof node.backendDOMNodeId === "number" &&
        isInteractive(role, properties)
      ) {
        const ref = `e${nextRef}`;
        nextRef += 1;
        refs.push({ ref, backendNodeId: node.backendDOMNodeId });
        parts.push(` [ref=${ref}]`);
      }
      for (const state of describeState(properties)) {
        parts.push(` [${state}]`);
      }
      const value = stringValue(node.value).trim();
      if (value.length > 0) {
        parts.push(`: ${JSON.stringify(value)}`);
      }
      line = parts.join("");
    }

    const before = lines.length;
    lines.push(line);
    for (const child of children) {
      walk(child, depth + 1);
    }
    // A node that turned out to have rendered children announces them with a
    // trailing colon, the way the format reads in Playwright.
    if (lines.length > before + 1 && !isText) {
      const own = lines[before] ?? "";
      if (!own.endsWith(":")) {
        lines[before] = `${own}:`;
      }
    }
  }

  for (const root of startingPoints) {
    walk(root, 0);
  }

  let text = lines.join("\n");
  if (text.length > maxLength) {
    text = text.slice(0, maxLength);
    truncated = true;
  }

  return { text, refs, truncated };
}
