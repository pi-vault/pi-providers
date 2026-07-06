export interface ThinkScanResult {
  text: string;
  think: string;
}

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
