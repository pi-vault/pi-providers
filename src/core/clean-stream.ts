// src/core/clean-stream.ts

import type {
  AssistantMessage,
  AssistantMessageEventStream,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { ThinkScanner } from "./think-scanner.ts";

interface TextState {
  scanner: ThinkScanner;
  started: boolean;
  index: number;
  block: TextContent;
}

interface ThinkingSegment {
  block: ThinkingContent;
  index: number;
  open: boolean;
  text: string;
  signature?: string;
}

export function cleanStream(base: AssistantMessageEventStream): AssistantMessageEventStream {
  const out = createAssistantMessageEventStream();

  void (async () => {
    let output: AssistantMessage | undefined;
    const toolIndexMap = new Map<number, number>();
    const textStates = new Map<number, TextState>();
    const baseThinkingAccs = new Map<number, string>();
    let sawBaseThinking = false;
    let segment: ThinkingSegment | undefined;

    const ensureOutput = (partial: AssistantMessage): AssistantMessage => {
      if (!output) output = { ...partial, content: [] };
      return output;
    };

    const syncMeta = (partial: AssistantMessage) => {
      if (!output) {
        ensureOutput(partial);
        return;
      }
      for (const key of Object.keys(partial)) {
        if (key === "content") continue;
        (output as unknown as Record<string, unknown>)[key] = (
          partial as unknown as Record<string, unknown>
        )[key];
      }
    };

    const ensureSegment = (): ThinkingSegment => {
      if (segment?.open) return segment;
      const block: ThinkingContent = { type: "thinking", thinking: "" };
      output!.content.push(block);
      segment = { block, index: output!.content.length - 1, open: true, text: "" };
      baseThinkingAccs.clear();
      out.push({ type: "thinking_start", contentIndex: segment.index, partial: output! });
      return segment;
    };

    const closeSegment = () => {
      if (!segment?.open) return;
      segment.open = false;
      segment.text = segment.text.trimEnd();
      segment.block.thinking = segment.text;
      if (segment.signature) {
        (segment.block as ThinkingContent & { thinkingSignature?: string }).thinkingSignature =
          segment.signature;
      }
      out.push({
        type: "thinking_end",
        contentIndex: segment.index,
        content: segment.text,
        partial: output!,
      });
    };

    const appendThinking = (delta: string) => {
      if (!delta || !output) return;
      const seg = ensureSegment();
      if (seg.text === "") {
        delta = delta.replace(/^\s+/, "");
        if (!delta) return;
      }
      seg.text += delta;
      seg.block.thinking = seg.text;
      out.push({ type: "thinking_delta", contentIndex: seg.index, delta, partial: output });
    };

    const pushBaseThinking = (contentIndex: number, delta: string) => {
      const acc = (baseThinkingAccs.get(contentIndex) ?? "") + delta;
      baseThinkingAccs.set(contentIndex, acc);
      const have = segment?.open ? segment.text : "";
      const norm = acc.replace(/^\s+/, "");
      if (norm.length <= have.length) {
        if (have.startsWith(norm)) return;
        appendThinking(delta);
      } else if (norm.startsWith(have)) {
        appendThinking(norm.slice(have.length));
      } else {
        appendThinking(delta);
      }
    };

    const pushInlineThinking = (think: string) => {
      if (!think || sawBaseThinking || !output) return;
      appendThinking(think);
    };

    const pushText = (state: TextState, text: string) => {
      if (!text || !output) return;
      if (!state.started) {
        text = text.replace(/^\s+/, "");
        if (!text) return;
        closeSegment();
        output.content.push(state.block);
        state.index = output.content.length - 1;
        state.started = true;
        out.push({ type: "text_start", contentIndex: state.index, partial: output });
      }
      state.block.text += text;
      out.push({ type: "text_delta", contentIndex: state.index, delta: text, partial: output });
    };

    try {
      for await (const ev of base) {
        switch (ev.type) {
          case "start": {
            ensureOutput(ev.partial);
            out.push({ type: "start", partial: output! });
            break;
          }
          case "thinking_start": {
            sawBaseThinking = true;
            syncMeta(ev.partial);
            baseThinkingAccs.set(ev.contentIndex, "");
            break;
          }
          case "thinking_delta": {
            syncMeta(ev.partial);
            pushBaseThinking(ev.contentIndex, ev.delta);
            break;
          }
          case "thinking_end": {
            syncMeta(ev.partial);
            const baseBlock = ev.partial.content[ev.contentIndex] as
              | (ThinkingContent & { thinkingSignature?: string })
              | undefined;
            if (segment && baseBlock?.type === "thinking" && baseBlock.thinkingSignature) {
              segment.signature = baseBlock.thinkingSignature;
            }
            break;
          }
          case "text_start": {
            syncMeta(ev.partial);
            textStates.set(ev.contentIndex, {
              scanner: new ThinkScanner(),
              started: false,
              index: -1,
              block: { type: "text", text: "" },
            });
            break;
          }
          case "text_delta": {
            syncMeta(ev.partial);
            const state = textStates.get(ev.contentIndex);
            if (!state) break;
            const { text, think } = state.scanner.feed(ev.delta);
            pushInlineThinking(think);
            pushText(state, text);
            break;
          }
          case "text_end": {
            syncMeta(ev.partial);
            const state = textStates.get(ev.contentIndex);
            if (!state) break;
            const tail = state.scanner.flush();
            pushInlineThinking(tail.think);
            pushText(state, tail.text);
            if (state.started) {
              state.block.text = state.block.text.trimEnd();
              out.push({
                type: "text_end",
                contentIndex: state.index,
                content: state.block.text,
                partial: output!,
              });
            }
            break;
          }
          case "toolcall_start": {
            syncMeta(ev.partial);
            closeSegment();
            const baseBlock = ev.partial.content[ev.contentIndex];
            output!.content.push(baseBlock as ToolCall);
            toolIndexMap.set(ev.contentIndex, output!.content.length - 1);
            out.push({
              type: "toolcall_start",
              contentIndex: toolIndexMap.get(ev.contentIndex)!,
              partial: output!,
            });
            break;
          }
          case "toolcall_delta": {
            syncMeta(ev.partial);
            const idx = toolIndexMap.get(ev.contentIndex);
            if (idx === undefined) break;
            out.push({
              type: "toolcall_delta",
              contentIndex: idx,
              delta: ev.delta,
              partial: output!,
            });
            break;
          }
          case "toolcall_end": {
            syncMeta(ev.partial);
            const idx = toolIndexMap.get(ev.contentIndex);
            if (idx === undefined) break;
            output!.content[idx] = ev.toolCall;
            out.push({
              type: "toolcall_end",
              contentIndex: idx,
              toolCall: ev.toolCall,
              partial: output!,
            });
            break;
          }
          case "done": {
            closeSegment();
            const message: AssistantMessage = {
              ...ev.message,
              content: output ? output.content : ev.message.content,
            };
            out.push({ type: "done", reason: ev.reason, message });
            break;
          }
          case "error": {
            closeSegment();
            const error: AssistantMessage = {
              ...ev.error,
              content: output ? output.content : ev.error.content,
            };
            out.push({ type: "error", reason: ev.reason, error });
            break;
          }
        }
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      const fallback: AssistantMessage = output ?? {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "minimax-openai",
        model: "MiniMax-M3",
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
