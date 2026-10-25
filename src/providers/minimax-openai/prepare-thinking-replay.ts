// src/providers/minimax-openai/prepare-thinking-replay.ts

import type { Api, Context, Model, TextContent } from "@earendil-works/pi-ai";

/**
 * Replays unsigned legacy thinking as ordered `<think>` text for the same
 * provider/model over OpenAI Chat Completions history. Native signed thinking
 * is left for Pi's serializer, and foreign history is untouched.
 *
 * Returns a new context only when something changes; nested message/content
 * objects are copied only along changed paths.
 */
export function prepareThinkingReplay<TContext extends Context>(
  context: TContext,
  model: Model<Api>,
): TContext {
  let messagesChanged = false;

  const messages = context.messages.map((message) => {
    if (message.role !== "assistant") return message;
    if (
      message.provider !== model.provider ||
      message.model !== model.id ||
      message.api !== "openai-completions"
    ) {
      return message;
    }

    let contentChanged = false;
    const content = message.content.map((block) => {
      if (block.type !== "thinking" || block.redacted || block.thinkingSignature) return block;
      contentChanged = true;
      return {
        type: "text",
        text: `<think>${block.thinking}</think>`,
      } satisfies TextContent;
    });

    if (!contentChanged) return message;
    messagesChanged = true;
    return { ...message, content };
  });

  return messagesChanged ? { ...context, messages } : context;
}
