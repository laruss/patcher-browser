import type { PromptInput } from "@patcher/domain";

export interface PromptTextInputArgs {
  text: string;
}

export function promptTextInput(args: PromptTextInputArgs): PromptInput {
  return { type: "text", text: args.text, mentions: [] };
}
