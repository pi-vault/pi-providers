// src/core/harden-tool-calls.ts

import type {
  AssistantMessage,
  AssistantMessageEventStream,
  ToolCall,
} from "@earendil-works/pi-ai";
import {
  createAssistantMessageEventStream,
  parseJsonWithRepair,
} from "@earendil-works/pi-ai";

/**
 * Returns true when the parsed arguments object is effectively empty —
 * either `{}` or has zero own-keys.
 */
function isEmptyArgs(args: Record<string, unknown>): boolean {
  return Object.keys(args).length === 0;
}

/**
 * Returns true when any array in the object contains at least one
 * empty object — a sign that M3 failed to generate nested JSON.
 */
function hasCollapsedNestedArgs(args: Record<string, unknown>): boolean {
  for (const value of Object.values(args)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        Object.keys(item as Record<string, unknown>).length === 0
      ) {
        return true;
      }
    }
  }
  return false;
}

function emitDiagnosticText(
  out: ReturnType<typeof createAssistantMessageEventStream>,
  toolName: string,
  partial: AssistantMessage,
): void {
  const msg =
    `\n[Note: Tool "${toolName}" received empty nested arguments -- ` +
    "this is a known MiniMax-M3 limitation with complex JSON schemas. " +
    "Do not retry this tool call.]\n";

  console.error(
    `[minimax-openai] collapsed args detected for tool "${toolName}"`,
  );

  // contentIndex doesn't matter for downstream since cleanStream
  // will remap it; use a high value to avoid collisions
  const idx = 9999;
  out.push({ type: "text_start", contentIndex: idx, partial });
  out.push({ type: "text_delta", contentIndex: idx, delta: msg, partial });
  out.push({ type: "text_end", contentIndex: idx, content: msg, partial });
}

/**
 * Defensive stream wrapper that accumulates raw tool-call argument deltas
 * and attempts a second-chance JSON parse when the upstream driver produces
 * empty arguments (`{}`).
 *
 * Designed to sit between the base driver stream and cleanStream:
 *   base → hardenToolCalls → cleanStream → Pi
 */
export function hardenToolCalls(
  base: AssistantMessageEventStream,
): AssistantMessageEventStream {
  const out = createAssistantMessageEventStream();

  void (async () => {
    const argDeltas = new Map<number, string>();
    const repairs = new Map<number, ToolCall>();
    let lastPartial: AssistantMessage | undefined;

    try {
      for await (const ev of base) {
        switch (ev.type) {
          case "start": {
            lastPartial = ev.partial;
            out.push(ev);
            break;
          }

          case "toolcall_start": {
            argDeltas.set(ev.contentIndex, "");
            out.push(ev);
            break;
          }

          case "toolcall_delta": {
            const acc = (argDeltas.get(ev.contentIndex) ?? "") + ev.delta;
            argDeltas.set(ev.contentIndex, acc);
            out.push(ev);
            break;
          }

          case "toolcall_end": {
            const toolCall = ev.toolCall;

            // Attempt repair if driver produced empty args
            if (isEmptyArgs(toolCall.arguments)) {
              const raw = argDeltas.get(ev.contentIndex);
              if (raw) {
                try {
                  const repaired = parseJsonWithRepair<Record<string, unknown>>(raw);
                  if (!isEmptyArgs(repaired)) {
                    const fixed: ToolCall = { ...toolCall, arguments: repaired };
                    repairs.set(ev.contentIndex, fixed);
                    out.push({ ...ev, toolCall: fixed });

                    // Check repaired args for collapse
                    if (hasCollapsedNestedArgs(repaired)) {
                      emitDiagnosticText(out, toolCall.name, ev.partial);
                    }

                    argDeltas.delete(ev.contentIndex);
                    break;
                  }
                } catch {
                  // Repair also failed — fall through to emit original
                }
              }
            }

            // Emit original, then check for collapsed args
            out.push(ev);
            if (hasCollapsedNestedArgs(toolCall.arguments)) {
              emitDiagnosticText(out, toolCall.name, ev.partial);
            }

            argDeltas.delete(ev.contentIndex);
            break;
          }

          case "done": {
            const { cacheRead, input } = ev.message.usage;
            if (cacheRead > 0) console.error(`[minimax-openai] cache hit: ${cacheRead} tokens cached`);
            else if (input > 1000) console.error(`[minimax-openai] cache miss: ${input} input tokens, 0 cached`);
            if (repairs.size === 0) { out.push(ev); break; }
            const content = ev.message.content.map((c, i) => repairs.get(i) ?? c);
            out.push({ ...ev, message: { ...ev.message, content } });
            break;
          }

          case "error": {
            if (repairs.size === 0) { out.push(ev); break; }
            const content = ev.error.content.map((c, i) => repairs.get(i) ?? c);
            out.push({ ...ev, error: { ...ev.error, content } });
            break;
          }

          default:
            out.push(ev);
        }
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      const fallback: AssistantMessage = lastPartial ?? {
        role: "assistant",
        content: [],
        api: "unknown",
        provider: "unknown",
        model: "unknown",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "error",
        timestamp: Date.now(),
      };
      out.push({
        type: "error",
        reason: "error",
        error: { ...fallback, stopReason: "error", errorMessage },
      });
    }
  })();

  return out;
}
