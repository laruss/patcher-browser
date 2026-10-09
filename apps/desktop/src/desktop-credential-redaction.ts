import type { AxNode } from "./desktop-browser-snapshot.js";
import type { CdpSession } from "./desktop-browser-cdp.js";
const known = new WeakMap<object, { documentId: string; ids: Set<number> }>();
export function rememberCredentialPassword(
  entry: object,
  documentId: string,
  id: number,
) {
  const state =
    known.get(entry)?.documentId === documentId
      ? known.get(entry)!
      : { documentId, ids: new Set<number>() };
  state.ids.add(id);
  known.set(entry, state);
}
export async function redactCredentialNodes(
  session: CdpSession,
  nodes: AxNode[],
  entry: object,
  documentId: string,
): Promise<AxNode[]> {
  const remembered =
    known.get(entry)?.documentId === documentId
      ? known.get(entry)!.ids
      : new Set<number>();
  const blocked = new Set<string>();
  const classified = new Map<number, boolean>();
  let budget = 128;
  for (const node of nodes) {
    const id = node.backendDOMNodeId;
    if (!node.value?.value && !(id && remembered.has(id))) continue;
    let password = id === undefined || remembered.has(id);
    if (id !== undefined && !password) {
      if (classified.has(id)) password = classified.get(id)!;
      else {
        password = true;
        if (budget-- > 0)
          try {
            const result = await session.send<{
              node?: { localName?: string; attributes?: string[] };
            }>("DOM.describeNode", { backendNodeId: id, depth: 0 });
            const attrs = result.node?.attributes;
            if (result.node?.localName && Array.isArray(attrs)) {
              let type: string | undefined;
              for (let index = 0; index < attrs.length; index += 2)
                if (attrs[index]?.toLowerCase() === "type")
                  type = attrs[index + 1];
              password =
                result.node.localName.toLowerCase() === "input" &&
                type?.toLowerCase() === "password";
            }
          } catch {
            /* Unknown values are redacted. */
          }
        classified.set(id, password);
      }
    }
    if (password && node.nodeId) blocked.add(node.nodeId);
  }
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  function hideChildren(id: string) {
    for (const child of byId.get(id)?.childIds ?? [])
      if (!blocked.has(child)) {
        blocked.add(child);
        hideChildren(child);
      }
  }
  for (const id of [...blocked]) hideChildren(id);
  return nodes.map((node) =>
    blocked.has(node.nodeId ?? "")
      ? {
          ...node,
          value: undefined,
          ...(node.role?.value === "StaticText" ||
          node.role?.value === "InlineTextBox"
            ? { name: undefined }
            : {}),
        }
      : node,
  );
}
