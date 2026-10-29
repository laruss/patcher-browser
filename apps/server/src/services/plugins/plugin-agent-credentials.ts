import type {
  PluginAgentToolContext,
  PluginAgentToolResult,
} from "@patcher/plugin-sdk";
import { runAsCredentialAgent } from "../browser/credential-agent-scope.js";
export function protectedAgentExecute(tool: { execute: unknown }) {
  const execute = tool.execute as (
    params: unknown,
    ctx: PluginAgentToolContext,
  ) => PluginAgentToolResult | Promise<PluginAgentToolResult>;
  return (params: unknown, ctx: PluginAgentToolContext) =>
    runAsCredentialAgent(() => execute.call(tool, params, ctx));
}
