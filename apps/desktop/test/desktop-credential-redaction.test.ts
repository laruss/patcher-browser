import { expect, it, vi } from "vitest";
import {
  redactCredentialNodes,
  rememberCredentialPassword,
} from "../src/desktop-credential-redaction.js";
import type { AxNode } from "../src/desktop-browser-snapshot.js";
import type { CdpSession } from "../src/desktop-browser-cdp.js";
const node = (
  nodeId: string,
  backendDOMNodeId: number,
  value: string,
): AxNode => ({
  nodeId,
  backendDOMNodeId,
  role: { value: "textbox" },
  value: { value },
});
it("redacts password values and descendants even when another attribute's value is 'type', preserving usernames", async () => {
  const session = {
    send: vi.fn(async (_method, args) => ({
      node: {
        localName: "input",
        attributes:
          args.backendNodeId === 1
            ? ["name", "type", "type", "PASSWORD"]
            : ["type", "text"],
      },
    })),
  } as unknown as CdpSession;
  const password = { ...node("p", 1, "sentinel"), childIds: ["c"] };
  const child = {
    nodeId: "c",
    role: { value: "StaticText" },
    name: { value: "sentinel" },
  };
  const result = await redactCredentialNodes(
    session,
    [password, child, node("u", 2, "alice")],
    {},
    "doc",
  );
  expect(JSON.stringify(result)).not.toContain("sentinel");
  expect(result[2]?.value?.value).toBe("alice");
});
it("redacts unknown/remembered nodes without trusting successful unrelated DOM reads and clears memory on a new document", async () => {
  const entry = {},
    session = {
      send: vi.fn(async () => {
        throw Error("Detached");
      }),
    } as unknown as CdpSession;
  rememberCredentialPassword(entry, "doc", 1);
  const result = await redactCredentialNodes(
    session,
    [node("p", 1, "sentinel"), node("unknown", 2, "sentinel")],
    entry,
    "doc",
  );
  expect(JSON.stringify(result)).not.toContain("sentinel");
  expect(session.send).toHaveBeenCalledTimes(1);
  const next = {
    send: vi.fn(async () => ({
      node: { localName: "input", attributes: ["type", "text"] },
    })),
  } as unknown as CdpSession;
  const fresh = await redactCredentialNodes(
    next,
    [node("u", 1, "alice")],
    entry,
    "next",
  );
  expect(fresh[0]?.value?.value).toBe("alice");
});
