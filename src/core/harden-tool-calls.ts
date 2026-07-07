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

            if (isEmptyArgs(toolCall.arguments)) {
              const raw = argDeltas.get(ev.contentIndex);
              if (raw) {
                try {
                  const repaired = parseJsonWithRepair<Record<string, unknown>>(raw);
                  if (!isEmptyArgs(repaired)) {
                    const fixed: ToolCall = { ...toolCall, arguments: repaired };
                    repairs.set(ev.contentIndex, fixed);
                    out.push({ ...ev, toolCall: fixed });
                    argDeltas.delete(ev.contentIndex);
                    break;
                  }
                } catch {
                  // Repair also failed — fall through to emit original
                }
              }
            }

            argDeltas.delete(ev.contentIndex);
            out.push(ev);
            break;
          }

          case "done": {
            if (repairs.size > 0) {
              const content = [...ev.message.content];
              for (const [idx, fixed] of repairs) {
                if (idx < content.length) content[idx] = fixed;
              }
              out.push({ ...ev, message: { ...ev.message, content } });
            } else {
              out.push(ev);
            }
            break;
          }

          case "error": {
            if (repairs.size > 0) {
              const content = [...ev.error.content];
              for (const [idx, fixed] of repairs) {
                if (idx < content.length) content[idx] = fixed;
              }
              out.push({ ...ev, error: { ...ev.error, content } });
            } else {
              out.push(ev);
            }
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
