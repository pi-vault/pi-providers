// src/providers/minimax-openai/clean-stream.ts

import type {
  AssistantMessage,
  AssistantMessageEventStream,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { ThinkScanner } from "./think-scanner.ts";

const LEAKED_TOOL_MARKUP_SENTINEL = "]<]minimax[>[<";
const LEAKED_TOOL_MARKUP_ERROR =
  "MiniMax returned malformed tool-call markup. Please retry your request.";

interface TextState {
  scanner: ThinkScanner;
  started: boolean;
  index: number;
  block: TextContent;
  leakedToolMarkupBuffer: string;
}

interface ThinkingSegment {
  block: ThinkingContent;
  index: number;
  open: boolean;
  text: string;
  signature?: string;
}

function scanLeakedToolMarkup(
  state: TextState,
  chunk: string,
): { text: string; leaked: boolean } {
  const combined = state.leakedToolMarkupBuffer + chunk;
  const index = combined.indexOf(LEAKED_TOOL_MARKUP_SENTINEL);
  if (index >= 0) {
    state.leakedToolMarkupBuffer = "";
    return { text: combined.slice(0, index), leaked: true };
  }

  let keep = 0;
  const max = Math.min(LEAKED_TOOL_MARKUP_SENTINEL.length - 1, combined.length);
  for (let size = max; size > 0; size--) {
    if (combined.endsWith(LEAKED_TOOL_MARKUP_SENTINEL.slice(0, size))) {
      keep = size;
      break;
    }
  }
  state.leakedToolMarkupBuffer = combined.slice(combined.length - keep);
  return { text: combined.slice(0, combined.length - keep), leaked: false };
}

function flushLeakedToolMarkup(state: TextState): string {
  const buffered = state.leakedToolMarkupBuffer;
  state.leakedToolMarkupBuffer = "";
  return buffered;
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

    const syncMeta = (partial: AssistantMessage) => {
      if (!output) { output = { ...partial, content: [] }; return; }
      const { content: _, ...meta } = partial;
      Object.assign(output, meta);
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

    const routeSafeText = (state: TextState, raw: string) => {
      const { text, think } = state.scanner.feed(raw);
      pushInlineThinking(think);
      pushText(state, text);
    };

    const flushScanner = (state: TextState) => {
      const tail = state.scanner.flush();
      pushInlineThinking(tail.think);
      pushText(state, tail.text);
    };

    const closeText = (state: TextState) => {
      if (!state.started || !output) return;
      state.block.text = state.block.text.trimEnd();
      out.push({
        type: "text_end",
        contentIndex: state.index,
        content: state.block.text,
        partial: output,
      });
    };

    try {
      for await (const ev of base) {
        switch (ev.type) {
          case "start": {
            if (!output) output = { ...ev.partial, content: [] };
            out.push({ type: "start", partial: output });
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
              leakedToolMarkupBuffer: "",
            });
            break;
          }
          case "text_delta": {
            syncMeta(ev.partial);
            const state = textStates.get(ev.contentIndex);
            if (!state) break;
            const scanned = scanLeakedToolMarkup(state, ev.delta);
            routeSafeText(state, scanned.text);
            if (scanned.leaked) {
              flushScanner(state);
              closeText(state);
              closeSegment();
              console.error("[minimax-openai] leaked tool-call markup detected");
              if (!output) return;
              out.push({
                type: "error",
                reason: "error",
                error: {
                  ...output,
                  stopReason: "error",
                  errorMessage: LEAKED_TOOL_MARKUP_ERROR,
                },
              });
              return;
            }
            break;
          }
          case "text_end": {
            syncMeta(ev.partial);
            const state = textStates.get(ev.contentIndex);
            if (!state) break;
            const trailing = flushLeakedToolMarkup(state);
            if (trailing) routeSafeText(state, trailing);
            flushScanner(state);
            closeText(state);
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
