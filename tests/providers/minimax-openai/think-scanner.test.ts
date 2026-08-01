import { describe, expect, it } from "vitest";
import { ThinkScanner } from "../../../src/providers/minimax-openai/think-scanner.ts";

describe("ThinkScanner", () => {
  describe("feed", () => {
    it("passes plain text through unchanged", () => {
      const scanner = new ThinkScanner();
      const result = scanner.feed("hello world");
      expect(result).toEqual({ text: "hello world", think: "" });
    });

    it("extracts single <think> block from text", () => {
      const scanner = new ThinkScanner();
      const result = scanner.feed("before<think>reasoning</think>after");
      expect(result).toEqual({ text: "beforeafter", think: "reasoning" });
    });

    it("extracts multiple <think> blocks from one chunk", () => {
      const scanner = new ThinkScanner();
      const result = scanner.feed("a<think>one</think>b<think>two</think>c");
      expect(result).toEqual({ text: "abc", think: "onetwo" });
    });

    it("handles opening tag split across two chunks", () => {
      const scanner = new ThinkScanner();
      const r1 = scanner.feed("hello<thi");
      const r2 = scanner.feed("nk>inside</think>after");
      expect(r1).toEqual({ text: "hello", think: "" });
      expect(r2).toEqual({ text: "after", think: "inside" });
    });

    it("handles closing tag split across two chunks", () => {
      const scanner = new ThinkScanner();
      const r1 = scanner.feed("<think>reasoning</th");
      const r2 = scanner.feed("ink>visible");
      expect(r1).toEqual({ text: "", think: "reasoning" });
      expect(r2).toEqual({ text: "visible", think: "" });
    });

    it("handles tag split at every character boundary", () => {
      const scanner = new ThinkScanner();
      const r1 = scanner.feed("<");
      const r2 = scanner.feed("t");
      const r3 = scanner.feed("h");
      const r4 = scanner.feed("i");
      const r5 = scanner.feed("n");
      const r6 = scanner.feed("k");
      const r7 = scanner.feed(">");
      const r8 = scanner.feed("content</think>end");
      // First 6 calls buffer partial tag prefix
      expect(r1).toEqual({ text: "", think: "" });
      expect(r2).toEqual({ text: "", think: "" });
      expect(r3).toEqual({ text: "", think: "" });
      expect(r4).toEqual({ text: "", think: "" });
      expect(r5).toEqual({ text: "", think: "" });
      expect(r6).toEqual({ text: "", think: "" });
      expect(r7).toEqual({ text: "", think: "" });
      expect(r8).toEqual({ text: "end", think: "content" });
    });

    it("handles empty string input", () => {
      const scanner = new ThinkScanner();
      expect(scanner.feed("")).toEqual({ text: "", think: "" });
    });

    it("does not match partial tags that are not real think tags", () => {
      const scanner = new ThinkScanner();
      const result = scanner.feed("a < b > c <div>html</div> <thinking>not</thinking>");
      expect(result).toEqual({
        text: "a < b > c <div>html</div> <thinking>not</thinking>",
        think: "",
      });
    });

    it("does not buffer mid-text partial tag followed by non-tag chars", () => {
      const scanner = new ThinkScanner();
      const result = scanner.feed("foo<thbar");
      expect(result).toEqual({ text: "foo<thbar", think: "" });
    });

    it("handles think block with no content", () => {
      const scanner = new ThinkScanner();
      const result = scanner.feed("before<think></think>after");
      expect(result).toEqual({ text: "beforeafter", think: "" });
    });

    it("handles multiline content inside think block", () => {
      const scanner = new ThinkScanner();
      const result = scanner.feed("text<think>line1\nline2\nline3</think>more");
      expect(result).toEqual({ text: "textmore", think: "line1\nline2\nline3" });
    });
  });

  describe("flush", () => {
    it("returns empty when nothing is buffered", () => {
      const scanner = new ThinkScanner();
      scanner.feed("complete text");
      expect(scanner.flush()).toEqual({ text: "", think: "" });
    });

    it("emits buffered partial tag as text when outside think", () => {
      const scanner = new ThinkScanner();
      scanner.feed("end<thi");
      const result = scanner.flush();
      expect(result).toEqual({ text: "<thi", think: "" });
    });

    it("emits buffered partial tag as think when inside think", () => {
      const scanner = new ThinkScanner();
      scanner.feed("<think>content</th");
      const result = scanner.flush();
      expect(result).toEqual({ text: "", think: "</th" });
    });

    it("handles unterminated think block (content stays as think)", () => {
      const scanner = new ThinkScanner();
      scanner.feed("before<think>never closed");
      const result = scanner.flush();
      // "never closed" was already emitted in feed, flush only has buffered bytes
      expect(result).toEqual({ text: "", think: "" });
    });

    it("is idempotent when called multiple times", () => {
      const scanner = new ThinkScanner();
      scanner.feed("text<thi");
      expect(scanner.flush()).toEqual({ text: "<thi", think: "" });
      expect(scanner.flush()).toEqual({ text: "", think: "" });
    });
  });

  describe("stateful sequences", () => {
    it("maintains state across multiple feed calls", () => {
      const scanner = new ThinkScanner();
      expect(scanner.feed("start ")).toEqual({ text: "start ", think: "" });
      expect(scanner.feed("<think>")).toEqual({ text: "", think: "" });
      expect(scanner.feed("mid ")).toEqual({ text: "", think: "mid " });
      expect(scanner.feed("</think>")).toEqual({ text: "", think: "" });
      expect(scanner.feed(" end")).toEqual({ text: " end", think: "" });
    });

    it("handles rapid alternation between text and think", () => {
      const scanner = new ThinkScanner();
      const r1 = scanner.feed("a<think>1</think>b<think>2</think>c");
      expect(r1).toEqual({ text: "abc", think: "12" });
    });
  });
});
