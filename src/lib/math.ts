/**
 * Client-side math clean-up before react-markdown + remark-math + KaTeX.
 *
 * 1. Delimiters: remark-math only understands $...$ and $$...$$. Convert \( \) and \[ \]
 *    (the server already does this for new answers; this covers older saved ones).
 * 2. Safety net: if the model writes math WITHOUT any delimiters (plain "a^2 + b^2",
 *    "H_2O"), KaTeX never sees it and students read a literal caret. Outside math and
 *    code, turn simple exponents/subscripts into Unicode super/subscripts (a², x¹⁰, H₂O).
 */

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ"
};
const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎"
};

const mapAll = (s: string, table: Record<string, string>) =>
  [...s].every((c) => c in table) ? [...s].map((c) => table[c]).join("") : null;

function convertDelimiters(text: string): string {
  let out = text.replace(/(^[ \t]*)?\\\[([\s\S]+?)\\\]/gm, (_m, indent: string | undefined, inner: string) => {
    const body = inner.replace(/\s*\n\s*/g, " ").trim();
    return indent !== undefined ? `${indent}$$\n${indent}${body}\n${indent}$$` : `$$${body}$$`;
  });
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_m, inner: string) => `$${inner.replace(/\s*\n\s*/g, " ").trim()}$`);
  return out;
}

function prettifyBareMath(text: string): string {
  // a^2, (a+b)^2, x^{10}, 10^-3, e^{-x}
  let out = text.replace(/([A-Za-z0-9)\]])\^(\{([^{}\s]{1,8})\}|[-−]?[0-9]{1,3}|[nixy])/g, (m, base: string, _w, braced?: string) => {
    const exp = braced ?? _w;
    const sup = mapAll(exp, SUP);
    return sup ? base + sup : m;
  });
  // H_2O, x_1, a_{12}  (digits only — never touches snake_case words)
  out = out.replace(/([A-Za-z)\]])_(\{([0-9+\-−=()]{1,6})\}|[0-9]{1,3})(?![a-z0-9_])/g, (m, base: string, _w, braced?: string) => {
    const sub = mapAll(braced ?? _w, SUB);
    return sub ? base + sub : m;
  });
  return out;
}

export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown) return markdown;

  // Never rewrite inside fenced code blocks or inline code.
  const codeParts = convertDelimiters(markdown).split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);

  return codeParts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      // Leave real math ($$...$$ / $...$) for KaTeX; only prettify the text between.
      const mathParts = part.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g);
      return mathParts.map((seg, j) => (j % 2 === 1 ? seg : prettifyBareMath(seg))).join("");
    })
    .join("");
}
