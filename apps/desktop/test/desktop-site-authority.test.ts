import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { browserCommandSchema } from "@patcher/domain";
import type { DesktopSitePolicy } from "@patcher/desktop-contract";
import {
  createDesktopSiteAuthority,
  siteDigest,
} from "../src/desktop-site-authority.js";

function fixture() {
  let context = {
    tabId: "tab",
    url: "https://a.example.com/private/a",
    origin: "https://a.example.com",
    documentId: randomUUID(),
  };
  const confirm = vi.fn(async () => true),
    changed = vi.fn();
  const authority = createDesktopSiteAuthority({
    resolve: (id) =>
      id === "tab"
        ? {
            context: { ...context },
            current: () => context,
            hostWebContentsId: 12,
          }
        : null,
    confirm,
    changed,
  });
  let policy: DesktopSitePolicy = {
    pluginId: "plugin",
    name: "Plugin",
    revision: randomUUID(),
    enabled: true,
    sites: ["https://*.example.com/private/*"],
    origins: [],
    permissions: [
      "tabs.read",
      "page.read",
      "page.inject",
      "pageScript.register",
      "pageStyle.register",
    ],
    scripts: [],
    styles: [],
  };
  const request = (method: string, payload: unknown) =>
    authority.request(method, payload, new AbortController().signal);
  async function update(patch: Partial<DesktopSitePolicy>) {
    policy = { ...policy, ...patch, revision: randomUUID() };
    await request("site.policy", policy);
  }
  const command = browserCommandSchema.parse({
    type: "page.get_url",
    tabId: "tab",
  });
  async function prepare() {
    return (await request("site.prepare", {
      owners: [{ pluginId: policy.pluginId, revision: policy.revision }],
      tabId: "tab",
      digest: siteDigest(command),
    })) as { token: string };
  }
  return {
    authority,
    command,
    confirm,
    request,
    update,
    prepare,
    policy: () => policy,
    navigate: (patch: Partial<typeof context>) => {
      context = { ...context, ...patch };
    },
  };
}
describe("main-owned site capabilities", () => {
  it("denies before grant, including renderer-supplied contributions", async () => {
    const f = fixture();
    await f.update({});
    await expect(f.prepare()).rejects.toThrow();
    expect(
      f.authority.allows("plugin", "https://a.example.com/private/a"),
    ).toBe(false);
    f.authority.setContributions({
      scripts: [
        {
          pluginId: "plugin",
          scriptId: "s",
          matches: ["https://*.example.com/private/*"],
          code: "1",
        },
      ],
      styles: [],
    });
    expect(f.authority.scripts()).toEqual([]);
  });
  it("binds command, sender window and one redemption", async () => {
    const f = fixture();
    await f.update({ origins: ["https://a.example.com"] });
    const { token } = await f.prepare();
    expect(() => f.authority.consume(token, f.command, 13)).toThrow();
    expect(() =>
      f.authority.consume(
        token,
        browserCommandSchema.parse({ type: "page.get_title", tabId: "tab" }),
        12,
      ),
    ).toThrow();
    const lease = f.authority.consume(token, f.command, 12);
    lease.assert();
    expect(() => f.authority.consume(token, f.command, 12)).toThrow();
    lease.close();
    await expect(f.request("site.check", { token })).rejects.toThrow();
  });
  it.each([
    "origin",
    "path",
    "document",
    "revoke",
    "disable",
    "restart",
    "disconnect",
  ])("invalidates in-flight operations on %s", async (reason) => {
    const f = fixture();
    await f.update({ origins: ["https://a.example.com"] });
    const { token } = await f.prepare(),
      lease = f.authority.consume(token, f.command, 12);
    if (reason === "origin")
      f.navigate({
        url: "https://b.example.com/private/a",
        origin: "https://b.example.com",
      });
    if (reason === "path")
      f.navigate({ url: "https://a.example.com/public/a" });
    if (reason === "document") f.navigate({ documentId: randomUUID() });
    if (reason === "revoke") await f.update({ origins: [] });
    if (reason === "disable") await f.update({ enabled: false });
    if (reason === "restart") f.authority.reset();
    if (reason === "disconnect") f.authority.disconnect();
    expect(() => lease.assert()).toThrow();
  });
  it("requires every owner and never trusts a requested callback URL", async () => {
    const f = fixture();
    await f.update({ origins: ["https://a.example.com"] });
    await expect(
      f.request("site.context", {
        owners: [{ pluginId: "plugin", revision: f.policy().revision }],
        tabId: "tab",
        url: "https://b.example.com/private/a",
      }),
    ).rejects.toThrow();
    await expect(
      f.request("site.prepare", {
        owners: [
          { pluginId: "plugin", revision: f.policy().revision },
          { pluginId: "other", revision: randomUUID() },
        ],
        tabId: "tab",
        digest: siteDigest(f.command),
      }),
    ).rejects.toThrow();
  });
  it("native confirmation uses the actual origin and rejects navigation while open", async () => {
    const f = fixture();
    await f.update({});
    f.confirm.mockImplementationOnce(async () => {
      f.navigate({ documentId: randomUUID() });
      return true;
    });
    await expect(
      f.request("site.confirm", {
        pluginId: "plugin",
        revision: f.policy().revision,
        tabId: "tab",
      }),
    ).rejects.toThrow();
    expect(f.confirm.mock.calls[0]).toBeDefined();
  });
  it("page RPC is method/input-bound, one-use, and stops after revoke", async () => {
    const f = fixture();
    await f.update({ origins: ["https://a.example.com"] });
    const token = f.authority.rpcToken("plugin", "tab", "method", "{}"),
      digest = siteDigest({
        pluginId: "plugin",
        method: "method",
        input: "{}",
      });
    await expect(
      f.request("site.redeem", { token, pluginId: "other", digest }),
    ).rejects.toThrow();
    await f.request("site.redeem", { token, pluginId: "plugin", digest });
    await expect(
      f.request("site.redeem", { token, pluginId: "plugin", digest }),
    ).rejects.toThrow();
    await f.update({ origins: [] });
    await expect(f.request("site.check", { token })).rejects.toThrow();
  });
  it("accepts only private-policy hashes and checks the live URL at injection", async () => {
    const f = fixture(),
      record = {
        pluginId: "plugin",
        scriptId: "s",
        matches: ["https://*.example.com/private/*"],
        code: "1",
      };
    await f.update({
      origins: ["https://a.example.com"],
      scripts: [siteDigest(record)],
    });
    f.authority.setContributions({
      scripts: [record, { ...record, code: "2" }],
      styles: [],
    });
    expect(f.authority.scripts()).toEqual([record]);
    expect(
      f.authority.acceptsContribution(
        record,
        "https://b.example.com/private/a",
      ),
    ).toBe(false);
    expect(
      f.authority.acceptsContribution(
        record,
        "https://a.example.com/private/a",
      ),
    ).toBe(true);
  });
});
