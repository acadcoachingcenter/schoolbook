/**
 * Normalizes LaTeX delimiters in model output so remark-math + KaTeX can render them.
 *
 * remark-math only understands `$...$` (inline) and `$$...$$` (display). The Groq model
 * (gpt-oss) often answers with `\( ... \)` and `\[ ... \]` instead. Markdown treats `\(`,
 * `\[`, `\;` as escaped punctuation and strips the backslash, so students saw broken
 * output like `[ a\cdot a ;+; b\cdot b . ]` and `((a+b)(a+b))`.
 *
 * Code spans and fenced code blocks are left untouched.
 */
export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown) return markdown;

  // Split out fenced code blocks and inline code so we never rewrite inside them.
  const parts = markdown.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);

  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // code segment

      let out = part;

      // Display math: \[ ... \]
      out = out.replace(/(^[ \t]*)?\\\[([\s\S]+?)\\\]/gm, (_m, indent: string | undefined, inner: string) => {
        const body = inner.replace(/\s*\n\s*/g, " ").trim();
        if (indent !== undefined) {
          // On its own line — emit a proper display block, keeping list indentation.
          return `${indent}$$\n${indent}${body}\n${indent}$$`;
        }
        return `$$${body}$$`;
      });

      // Inline math: \( ... \)
      out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_m, inner: string) => `$${inner.replace(/\s*\n\s*/g, " ").trim()}$`);

      return out;
    })
    .join("");
}
