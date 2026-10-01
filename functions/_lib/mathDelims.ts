/**
 * Server-side LaTeX delimiter normalizer.
 *
 * The model (gpt-oss) frequently writes math as \( ... \) and \[ ... \]. The client
 * renders with remark-math, which only understands $...$ and $$...$$ — and Markdown
 * strips the backslash from \( \[ \; \\ before KaTeX ever sees them, which is why
 * students saw "[ a\cdot a ;+; b\cdot b ]" and "((a+b)^2 = ...)".
 *
 * Converting at the source (instead of only in the React renderer) fixes every
 * client that consumes this API — the SchoolBook page, any acadapp.in embed, and
 * the conversation history saved to D1.
 *
 *   \(  \)  ->  $        (inline)
 *   \[  \]  ->  \n$$\n   (display, fence on its own line so remark-math opens a block)
 *
 * Only an UNESCAPED delimiter is converted: "\\[2pt]" (a LaTeX row break with spacing)
 * has an even backslash run and is left alone.
 */

const REPLACEMENTS: Record<string, string> = {
  "(": "$",
  ")": "$",
  "[": "\n$$\n",
  "]": "\n$$\n"
};

function convert(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "\\") {
      out += text[i++];
      continue;
    }
    let run = 0;
    while (text[i + run] === "\\") run++;
    const next = text[i + run];
    if (run % 2 === 1 && next !== undefined && next in REPLACEMENTS) {
      out += "\\".repeat(run - 1) + REPLACEMENTS[next];
      i += run + 1;
    } else {
      out += "\\".repeat(run);
      i += run;
    }
  }
  return out;
}

/** One-shot conversion for complete strings (non-streaming /api/ask). */
export function normalizeMathText(text: string): string {
  return convert(text ?? "");
}

/**
 * Streaming-safe converter: a delimiter can be split across tokens ("\" then "["),
 * so any trailing backslashes are held back until the next token arrives.
 */
export class MathDelimiterStream {
  private carry = "";

  push(token: string): string {
    let text = this.carry + token;
    this.carry = "";
    const m = text.match(/\\+$/);
    if (m) {
      this.carry = m[0];
      text = text.slice(0, -m[0].length);
    }
    return convert(text);
  }

  flush(): string {
    const rest = this.carry;
    this.carry = "";
    return rest;
  }
}
