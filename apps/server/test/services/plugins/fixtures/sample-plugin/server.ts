/**
 * A real plugin server entry, loaded by the plugin process the way a user's
 * plugin is: default-exported factory, `patcher` as its only argument.
 *
 * It touches one member of each kind the boundary has to carry — a
 * notification (`log`), a request with a result (`storage.kv`), a registration
 * the host later calls back into (`contextMenu`, `agents.registerTool`), and a
 * dispose hook.
 */
export default function plugin(patcher: {
  log: { info(message: string): void };
  storage: { kv: { set(key: string, value: unknown): Promise<void> } };
  browser: {
    registerContextMenuItem(item: {
      id: string;
      title: string;
      run(context: { selectionText: string | null }): string;
    }): void;
  };
  agents: {
    registerTool(tool: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      execute(params: unknown, ctx: { threadId: string }): Promise<string>;
    }): void;
  };
  onDispose(hook: () => void): void;
}): void {
  patcher.log.info("sample plugin loading");

  void patcher.storage.kv.set("loaded", { at: "factory" });

  patcher.browser.registerContextMenuItem({
    id: "shout",
    title: "Shout",
    run: (context) => (context.selectionText ?? "").toUpperCase(),
  });

  patcher.agents.registerTool({
    name: "sample_echo",
    description: "Echoes its argument back.",
    parameters: { type: "object", properties: { text: { type: "string" } } },
    execute: async (params, ctx) =>
      `${ctx.threadId}: ${(params as { text?: string }).text ?? ""}`,
  });

  patcher.onDispose(() => {
    patcher.log.info("sample plugin disposing");
  });
}
