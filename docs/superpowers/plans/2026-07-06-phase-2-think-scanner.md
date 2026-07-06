# Phase 2: ThinkScanner Utility

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and test an incremental `<think>` tag parser that splits streaming text into visible content and thinking content, handling tags split across chunk boundaries.

**Architecture:** A single class (`ThinkScanner`) with a `feed(chunk)` / `flush()` interface. It buffers partial tag suffixes between calls and tracks whether the scanner is inside or outside a `<think>` block. Pure string processing with no external dependencies beyond a shared type.

**Tech Stack:** TypeScript (erasable syntax only), Vitest.

**Prerequisite:** Phase 1 complete (extension registers bare providers).

**Result:** A tested utility ready for integration in Phase 3. The extension continues working as-is from Phase 1 — this phase adds no runtime behavior change.

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/shared/types.ts` | `ThinkScanResult` interface used by ThinkScanner |
| `src/core/think-scanner.ts` | Incremental `<think>` / `</think>` tag parser |
| `tests/core/think-scanner.test.ts` | Unit tests covering all edge cases |

---

## Verification Commands

```bash
pnpm run check
```

---

### Task 1: Shared Types

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: Create the shared types file**

```ts
// src/shared/types.ts

export interface ThinkScanResult {
  text: string;
  think: string;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add ThinkScanResult shared type"
```

---

### Task 2: ThinkScanner Implementation

**Files:**
- Create: `src/core/think-scanner.ts`
- Test: `tests/core/think-scanner.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/core/think-scanner.test.ts

import { describe, expect, it } from "vitest";
import { ThinkScanner } from "../../src/core/think-scanner.ts";

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
      expect(result).toEqual({ text: "a < b > c <div>html</div> <thinking>not</thinking>", think: "" });
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- tests/core/think-scanner.test.ts`
Expected: FAIL — cannot resolve `../../src/core/think-scanner.ts`

- [ ] **Step 3: Implement ThinkScanner**

```ts
// src/core/think-scanner.ts

import type { ThinkScanResult } from "../shared/types.ts";

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

export class ThinkScanner {
  private buf = "";
  private inThink = false;

  feed(chunk: string): ThinkScanResult {
    let text = "";
    let think = "";
    const s = this.buf + chunk;
    this.buf = "";
    let i = 0;
    while (i < s.length) {
      const tag = this.inThink ? CLOSE_TAG : OPEN_TAG;
      const idx = s.indexOf(tag, i);
      if (idx !== -1) {
        const piece = s.slice(i, idx);
        if (this.inThink) think += piece;
        else text += piece;
        this.inThink = !this.inThink;
        i = idx + tag.length;
      } else {
        const keep = partialTagSuffix(s, i, tag);
        const piece = s.slice(i, s.length - keep);
        if (this.inThink) think += piece;
        else text += piece;
        this.buf = s.slice(s.length - keep);
        i = s.length;
      }
    }
    return { text, think };
  }

  flush(): ThinkScanResult {
    const rest = this.buf;
    this.buf = "";
    if (!rest) return { text: "", think: "" };
    return this.inThink ? { text: "", think: rest } : { text: rest, think: "" };
  }
}

function partialTagSuffix(s: string, from: number, tag: string): number {
  const tail = s.slice(from);
  const max = Math.min(tag.length - 1, tail.length);
  for (let k = max; k > 0; k--) {
    if (tail.endsWith(tag.slice(0, k))) return k;
  }
  return 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- tests/core/think-scanner.test.ts`
Expected: all 18 tests PASS

- [ ] **Step 5: Run full check**

Run: `pnpm run check`
Expected: lint, typecheck, and all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/core/think-scanner.ts tests/core/think-scanner.test.ts
git commit -m "feat: implement ThinkScanner for incremental <think> tag parsing

Splits streaming text into visible content and thinking content.
Handles tags split across chunk boundaries by buffering partial
tag suffixes between feed() calls."
```

---

## Result After Phase 2

- Extension still works exactly as Phase 1 (bare provider, no stream cleaning)
- `ThinkScanner` is implemented and tested with 18 test cases covering:
  - Normal text pass-through
  - Single and multiple `<think>` blocks
  - Tags split at arbitrary chunk boundaries (including character-by-character)
  - Empty content, multiline content
  - Flush behavior for unterminated blocks and partial tags
  - Stateful multi-call sequences
- Ready for integration in Phase 3's `cleanStream`
