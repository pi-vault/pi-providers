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
  hasText: boolean;
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

function scanLeakedToolMarkup(state: TextState, chunk: string): { text: string; leaked: boolean } {
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

export function cleanStream(base: AssistantMessageEventStream): AssistantMessageEventStream {
  const out = createAssistantMessageEventStream();

  void (async () => {
    let output: AssistantMessage | undefined;
    const toolIndexMap = new Map<number, number>();
    const textStates = new Map<number, TextState>();
    const baseThinkingSignatures = new Map<number, string>();
    let sawBaseThinking = false;
    let segment: ThinkingSegment | undefined;

    const syncMeta = (partial: AssistantMessage) => {
      if (!output) {
        output = { ...partial, content: [] };
        return;
      }
      const { content: _, ...meta } = partial;
      Object.assign(output, meta);
    };

    const ensureSegment = (signature?: string): ThinkingSegment => {
      if (segment?.open) {
        if (signature && !segment.signature) segment.signature = signature;
        return segment;
      }
      closeAllText();
      const block: ThinkingContent = { type: "thinking", thinking: "" };
      if (signature) block.thinkingSignature = signature;
      output!.content.push(block);
      segment = {
        block,
        index: output!.content.length - 1,
        open: true,
        text: "",
        signature,
      };
      out.push({ type: "thinking_start", contentIndex: segment.index, partial: output! });
      return segment;
    };

    const closeSegment = () => {
      if (!segment?.open) return;
      segment.open = false;
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

    const appendThinking = (delta: string, signature?: string) => {
      if (!delta || !output) return;
      const seg = ensureSegment(signature);
      seg.text += delta;
      seg.block.thinking = seg.text;
      out.push({ type: "thinking_delta", contentIndex: seg.index, delta, partial: output });
    };

    const signatureAt = (partial: AssistantMessage, contentIndex: number) => {
      const block = partial.content[contentIndex];
      return block?.type === "thinking" ? block.thinkingSignature : undefined;
    };

    const pushBaseThinking = (contentIndex: number, delta: string, partial: AssistantMessage) => {
      const signature =
        signatureAt(partial, contentIndex) ?? baseThinkingSignatures.get(contentIndex);
      if (signature) baseThinkingSignatures.set(contentIndex, signature);
      appendThinking(delta, signature);
    };

    const pushInlineThinking = (think: string) => {
      if (!think || sawBaseThinking || !output) return;
      appendThinking(think);
    };

    // Thinking/tool boundaries split a text run, but its surrounding whitespace is internal text.
    const closeText = (state: TextState, trimEnd = false) => {
      if (trimEnd) state.block.text = state.block.text.trimEnd();
      if (!state.started || !output) return;
      out.push({
        type: "text_end",
        contentIndex: state.index,
        content: state.block.text,
        partial: output,
      });
      state.started = false;
      state.index = -1;
    };

    const closeAllText = (trimEnd = false) => {
      for (const state of textStates.values()) closeText(state, trimEnd);
    };

    const pushText = (state: TextState, text: string) => {
      if (!text || !output) return;
      if (!state.started) {
        if (!state.hasText) text = text.replace(/^\s+/, "");
        if (!text) return;
        closeSegment();
        state.block = { type: "text", text: "" };
        output.content.push(state.block);
        state.index = output.content.length - 1;
        state.started = true;
        state.hasText = true;
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
            const signature = signatureAt(ev.partial, ev.contentIndex);
            if (signature) baseThinkingSignatures.set(ev.contentIndex, signature);
            break;
          }
          case "thinking_delta": {
            syncMeta(ev.partial);
            pushBaseThinking(ev.contentIndex, ev.delta, ev.partial);
            break;
          }
          case "thinking_end": {
            syncMeta(ev.partial);
            const signature = signatureAt(ev.partial, ev.contentIndex);
            if (signature) {
              baseThinkingSignatures.set(ev.contentIndex, signature);
              if (segment?.open && !segment.signature) segment.signature = signature;
            }
            break;
          }
          case "text_start": {
            syncMeta(ev.partial);
            const previous = textStates.get(ev.contentIndex);
            if (previous) closeText(previous, true);
            textStates.set(ev.contentIndex, {
              scanner: new ThinkScanner(),
              started: false,
              hasText: false,
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
              closeText(state, true);
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
            const trailing = state.leakedToolMarkupBuffer;
            state.leakedToolMarkupBuffer = "";
            if (trailing) routeSafeText(state, trailing);
            flushScanner(state);
            closeText(state, true);
            break;
          }
          case "toolcall_start": {
            syncMeta(ev.partial);
            closeAllText();
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
            closeAllText(true);
            closeSegment();
            const message: AssistantMessage = {
              ...ev.message,
              content: output ? output.content : ev.message.content,
            };
            out.push({ type: "done", reason: ev.reason, message });
            break;
          }
          case "error": {
            closeAllText(true);
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
