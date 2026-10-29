import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  permissionForBrowserCommand,
  type BrowserCommand,
} from "@patcher/domain";
import {
  pluginSiteAccessAllows,
  pluginSiteCeilingAllows,
} from "@patcher/domain/plugin-site-access";
import {
  sitePolicySchema,
  type DesktopSitePolicy,
  type DesktopSiteContext,
  type ScopedPageContributions,
} from "@patcher/desktop-contract";
import { SecretStorageError } from "@patcher/secret-storage";

export function siteDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export interface SiteTarget {
  context: DesktopSiteContext;
  hostWebContentsId: number;
  current(): DesktopSiteContext | null;
  credentials?: {
    webContentsId: number;
    rememberPassword(id: number): void;
    interactive(): boolean;
    send(method: string, params: Record<string, unknown>): Promise<unknown>;
    execute(code: string): Promise<unknown>;
  };
  authPrompt?(): {
    id: string;
    url: string;
    host: string;
    insecure: boolean;
    isProxy: boolean;
    urls: string[];
  } | null;
}
const ownersSchema = z
  .array(
    z
      .object({ pluginId: z.string().min(1).max(128), revision: z.uuid() })
      .strict(),
  )
  .min(1)
  .max(8);
type Owners = z.infer<typeof ownersSchema>;
interface Ticket {
  target: SiteTarget;
  owners: Owners;
  digest?: string;
  kind: "command" | "rpc" | "context" | "auth";
  authPrompt?: { id: string; url: string };
  used: boolean;
  expires: number;
  controller: AbortController;
}
function refuse(): never {
  throw new SecretStorageError("conflict");
}

/** Policies arrive only through the owned server's inherited pipe. */
export function createDesktopSiteAuthority(args: {
  resolve: (tabId: string) => SiteTarget | null;
  confirm: (
    policy: DesktopSitePolicy,
    target: SiteTarget,
    signal: AbortSignal,
  ) => Promise<boolean>;
  changed: () => void;
  cleanup?: () => Array<{ pluginId: string; tabId: string }>;
  cancelAuth?: (target: SiteTarget, id: string) => void;
}) {
  const policies = new Map<string, DesktopSitePolicy>();
  const tickets = new Map<string, Ticket>();
  const prompts = new Map<
    string,
    { controller: AbortController; tabId: string }
  >();
  let contributions: ScopedPageContributions = { scripts: [], styles: [] };
  let connected = true;
  function policyOwners(ids: string[]): Owners {
    return ids.map((pluginId) => {
      const policy = policies.get(pluginId);
      if (!policy?.enabled) return refuse();
      return { pluginId, revision: policy.revision };
    });
  }
  function assert(ticket: Ticket) {
    const current = ticket.target.current();
    if (
      !connected ||
      ticket.controller.signal.aborted ||
      ticket.expires <= Date.now() ||
      current === null ||
      current.documentId !== ticket.target.context.documentId ||
      current.url !== ticket.target.context.url
    )
      refuse();
    const auth = ticket.authPrompt
      ? (ticket.target.authPrompt?.() ?? undefined)
      : undefined;
    if (
      ticket.authPrompt &&
      (!auth ||
        auth.isProxy ||
        auth.id !== ticket.authPrompt?.id ||
        auth.url !== ticket.authPrompt.url ||
        auth.host !== new URL(auth.url).host ||
        auth.insecure !== auth.url.startsWith("http:"))
    )
      refuse();
    for (const owner of ticket.owners) {
      const policy = policies.get(owner.pluginId);
      if (
        !policy?.enabled ||
        policy.revision !== owner.revision ||
        !pluginSiteAccessAllows(policy.sites, policy.origins, current.url) ||
        (auth !== undefined &&
          (!policy.permissions.includes("auth.provide") ||
            auth.urls.some(
              (url) =>
                !pluginSiteAccessAllows(policy.sites, policy.origins, url),
            )))
      )
        refuse();
    }
  }
  function ticketFor(
    owners: Owners,
    tabId: string,
    kind: Ticket["kind"],
    digest?: string,
    authPrompt?: Ticket["authPrompt"],
  ) {
    const target = args.resolve(tabId);
    if (target === null) return refuse();
    const ticket: Ticket = {
      target,
      owners,
      kind,
      digest,
      authPrompt,
      used: false,
      expires: Date.now() + 60_000,
      controller: new AbortController(),
    };
    assert(ticket);
    for (const [token, old] of tickets)
      if (old.expires <= Date.now()) {
        old.controller.abort();
        tickets.delete(token);
      }
    if (tickets.size >= 256) return refuse();
    const token = randomUUID();
    tickets.set(token, ticket);
    if (kind === "auth" && authPrompt)
      ticket.controller.signal.addEventListener(
        "abort",
        () => args.cancelAuth?.(target, authPrompt.id),
        { once: true },
      );
    return { token, ticket };
  }
  function invalidate(pluginId?: string) {
    for (const [token, ticket] of tickets)
      if (
        pluginId === undefined ||
        ticket.owners.some((owner) => owner.pluginId === pluginId)
      ) {
        ticket.controller.abort();
        tickets.delete(token);
      }
    for (const [id, prompt] of prompts)
      if (pluginId === undefined || id === pluginId) prompt.controller.abort();
  }
  function known(pluginId: string) {
    return policies.has(pluginId);
  }
  function allows(pluginId: string, url: string) {
    const policy = policies.get(pluginId);
    return (
      connected &&
      policy?.enabled === true &&
      pluginSiteAccessAllows(policy.sites, policy.origins, url)
    );
  }
  function setContributions(value: ScopedPageContributions) {
    contributions = {
      scripts: value.scripts.filter((record) =>
        policies.get(record.pluginId)?.scripts.includes(siteDigest(record)),
      ),
      styles: value.styles.filter((record) =>
        policies.get(record.pluginId)?.styles.includes(siteDigest(record)),
      ),
    };
    args.changed();
  }
  async function request(
    method: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (!connected || signal.aborted)
      throw new SecretStorageError("unavailable");
    if (method === "site.cleanup") {
      if (payload !== null) return refuse();
      return args.cleanup?.() ?? [];
    }
    if (method === "site.policy") {
      const policy = sitePolicySchema.parse(payload);
      invalidate(policy.pluginId);
      policies.set(policy.pluginId, policy);
      setContributions(contributions);
      return true;
    }
    if (method === "site.confirm") {
      const data = z
        .object({ pluginId: z.string(), revision: z.uuid(), tabId: z.string() })
        .strict()
        .parse(payload);
      const policy = policies.get(data.pluginId),
        target = args.resolve(data.tabId);
      if (
        !policy?.enabled ||
        policy.revision !== data.revision ||
        target === null ||
        !pluginSiteCeilingAllows(policy.sites, target.context.url) ||
        prompts.has(data.pluginId)
      )
        return refuse();
      const controller = new AbortController();
      prompts.set(data.pluginId, { controller, tabId: data.tabId });
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      try {
        const accepted = await args.confirm(policy, target, controller.signal);
        const current = target.current();
        if (
          !accepted ||
          controller.signal.aborted ||
          policies.get(data.pluginId) !== policy ||
          current?.documentId !== target.context.documentId ||
          current.url !== target.context.url
        )
          throw new SecretStorageError("cancelled");
        return target.context;
      } finally {
        signal.removeEventListener("abort", abort);
        prompts.delete(data.pluginId);
      }
    }
    if (method === "site.auth") {
      const data = z
        .object({
          owners: ownersSchema,
          tabId: z.string().min(1).max(128),
          id: z.string().min(1).max(128),
          digest: z.string().regex(/^[a-f0-9]{64}$/u),
        })
        .strict()
        .parse(payload);
      const prompt = args.resolve(data.tabId)?.authPrompt?.();
      if (!prompt || prompt.id !== data.id) return refuse();
      const { token } = ticketFor(
        data.owners,
        data.tabId,
        "auth",
        data.digest,
        { id: prompt.id, url: prompt.url },
      );
      return { token };
    }
    if (method === "site.prepare" || method === "site.context") {
      const data = z
        .object({
          owners: ownersSchema,
          tabId: z.string().min(1).max(128),
          url: z.string().max(4096).optional(),
          authPromptId: z.string().min(1).max(128).optional(),
          digest: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .optional(),
        })
        .strict()
        .parse(payload);
      if (method === "site.prepare" && data.digest === undefined)
        return refuse();
      const prompt =
        data.authPromptId === undefined
          ? undefined
          : args.resolve(data.tabId)?.authPrompt?.();
      if (
        data.authPromptId !== undefined &&
        (!prompt ||
          prompt.id !== data.authPromptId ||
          method !== "site.context")
      )
        return refuse();
      const { token, ticket } = ticketFor(
        data.owners,
        data.tabId,
        method === "site.prepare" ? "command" : "context",
        data.digest,
        prompt ? { id: prompt.id, url: prompt.url } : undefined,
      );
      if (data.url !== undefined && data.url !== ticket.target.context.url) {
        tickets.delete(token);
        return refuse();
      }
      return {
        token,
        ...ticket.target.context,
        hostWebContentsId: ticket.target.hostWebContentsId,
      };
    }
    const data = z
      .object({
        token: z.uuid(),
        pluginId: z.string().optional(),
        digest: z.string().optional(),
      })
      .strict()
      .parse(payload);
    const ticket = tickets.get(data.token);
    if (method === "site.release") {
      ticket?.controller.abort();
      tickets.delete(data.token);
      return true;
    }
    if (!ticket) return refuse();
    assert(ticket);
    if (method === "site.redeem") {
      if (
        ticket.kind !== "rpc" ||
        ticket.used ||
        ticket.digest !== data.digest ||
        ticket.owners[0]?.pluginId !== data.pluginId
      )
        return refuse();
      ticket.used = true;
    } else if (method !== "site.check") return refuse();
    return { ...ticket.target.context, owners: ticket.owners };
  }
  function consume(
    token: string,
    command: BrowserCommand,
    hostWebContentsId: number,
  ) {
    const ticket = tickets.get(token);
    if (
      !ticket ||
      ticket.used ||
      ticket.kind !== "command" ||
      ticket.digest !== siteDigest(command) ||
      ticket.target.hostWebContentsId !== hostWebContentsId ||
      !("tabId" in command) ||
      command.tabId !== ticket.target.context.tabId
    )
      return refuse();
    assert(ticket);
    for (const owner of ticket.owners)
      if (
        !policies
          .get(owner.pluginId)
          ?.permissions.includes(permissionForBrowserCommand(command))
      )
        return refuse();
    ticket.used = true;
    return {
      context: ticket.target.context,
      signal: ticket.controller.signal,
      assert: () => assert(ticket),
      close: () => {
        ticket.controller.abort();
        tickets.delete(token);
      },
    };
  }
  return {
    request,
    known,
    allows,
    consume,
    consumeCredentialContext(token: string, owner: string) {
      const ticket = tickets.get(token);
      if (
        !ticket ||
        ticket.used ||
        ticket.kind !== "context" ||
        !ticket.owners.some((one) => one.pluginId === owner)
      )
        return refuse();
      assert(ticket);
      for (const one of ticket.owners)
        if (
          !policies
            .get(one.pluginId)
            ?.permissions.includes("credentials.manage")
        )
          return refuse();
      ticket.used = true;
      ticket.expires += 60_000;
      return {
        target: ticket.target,
        name: policies.get(owner)!.name,
        signal: ticket.controller.signal,
        assert: () => assert(ticket),
        close: () => {
          ticket.controller.abort();
          tickets.delete(token);
        },
      };
    },
    setContributions,
    scripts: () =>
      contributions.scripts.filter(
        (record) => policies.get(record.pluginId)?.enabled,
      ),
    styles: () =>
      contributions.styles.filter(
        (record) => policies.get(record.pluginId)?.enabled,
      ),
    acceptsContribution(
      record:
        | ScopedPageContributions["scripts"][number]
        | ScopedPageContributions["styles"][number],
      url: string,
    ) {
      const policy = policies.get(record.pluginId);
      return (
        allows(record.pluginId, url) &&
        ("code" in record
          ? policy?.scripts.includes(siteDigest(record)) &&
            policy.permissions.includes("pageScript.register")
          : policy?.styles.includes(siteDigest(record)) &&
            policy.permissions.includes("pageStyle.register"))
      );
    },
    consumeAuth(
      answer: import("@patcher/domain/plugin-site-access").ScopedAuthAnswer,
      hostWebContentsId: number,
    ) {
      const ticket = tickets.get(answer.token);
      if (
        !ticket ||
        ticket.kind !== "auth" ||
        ticket.used ||
        ticket.target.hostWebContentsId !== hostWebContentsId ||
        ticket.target.context.tabId !== answer.tabId ||
        ticket.authPrompt?.id !== answer.id ||
        ticket.digest !== siteDigest(answer.answer)
      )
        return refuse();
      assert(ticket);
      ticket.used = true;
      tickets.delete(answer.token);
      return true;
    },
    rpcGuard(token: string) {
      const ticket = tickets.get(token);
      if (!ticket || ticket.kind !== "rpc") return refuse();
      return {
        assert: () => assert(ticket),
        close: () => {
          ticket.controller.abort();
          tickets.delete(token);
        },
      };
    },
    rpcToken(pluginId: string, tabId: string, method: string, input: string) {
      return ticketFor(
        policyOwners([pluginId]),
        tabId,
        "rpc",
        siteDigest({ pluginId, method, input }),
      ).token;
    },
    documentChanged(tabId: string) {
      for (const [token, ticket] of tickets)
        if (ticket.target.context.tabId === tabId) {
          ticket.controller.abort();
          tickets.delete(token);
        }
      for (const prompt of prompts.values())
        if (prompt.tabId === tabId) prompt.controller.abort();
      args.changed();
    },
    disconnect() {
      connected = false;
      invalidate();
      args.changed();
    },
    reset() {
      invalidate();
      for (const [id, policy] of policies)
        policies.set(id, { ...policy, enabled: false, revision: randomUUID() });
      args.changed();
    },
  };
}
export type DesktopSiteAuthority = ReturnType<
  typeof createDesktopSiteAuthority
>;
