// src/core/normalize-tool-results.ts

import type {
  AssistantMessage,
  Context,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";

/**
 * Reorders tool result messages so they match the order of the
 * corresponding tool_use blocks in the preceding assistant message.
 * MiniMax requires strict ordering — mismatches cause 400 errors.
 *
 * Returns a new Context; does not mutate the input.
 */
export function normalizeToolResults(context: Context): Context {
  const messages = [...context.messages];
  let changed = false;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;

    const toolCalls = (msg as AssistantMessage).content.filter(
      (c): c is ToolCall => c.type === "toolCall",
    );
    if (toolCalls.length < 2) continue;

    // Collect consecutive toolResult messages after this assistant message
    const resultStart = i + 1;
    let resultEnd = resultStart;
    while (
      resultEnd < messages.length &&
      messages[resultEnd].role === "toolResult"
    ) {
      resultEnd++;
    }

    const results = messages.slice(
      resultStart,
      resultEnd,
    ) as ToolResultMessage[];
    if (results.length < 2) continue;

    // Build the desired order based on tool call IDs
    const idOrder = toolCalls.map((tc) => tc.id);
    const resultMap = new Map<string, ToolResultMessage>();
    for (const r of results) {
      resultMap.set(r.toolCallId, r);
    }

    const sorted: ToolResultMessage[] = [];
    for (const id of idOrder) {
      const r = resultMap.get(id);
      if (r) {
        sorted.push(r);
        resultMap.delete(id);
      }
    }
    // Append any results not matched to a tool call (shouldn't happen, but be safe)
    for (const r of resultMap.values()) {
      sorted.push(r);
    }

    // Check if order actually changed
    const orderChanged = sorted.some(
      (r, idx) => r.toolCallId !== results[idx]?.toolCallId,
    );
    if (orderChanged) {
      messages.splice(resultStart, results.length, ...sorted);
      changed = true;
    }
  }

  return changed ? { ...context, messages } : context;
}
