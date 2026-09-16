/**
 * C# for `@tanstack/highlight` — Pods are C# scripts, so C# is the one language the
 * upstream language set is missing and we own (ledger, 2026-09-15).
 *
 * Modelled on the package's own pattern languages (`languages/python.js`). The pattern
 * walker `collectPatternRanges` lives in the package's `internal/` folder, which its
 * `exports` map does not publish, so the 25 lines below are a local copy: patterns run in
 * order and the first to claim a span keeps it, so comments and strings must lead and
 * keywords must beat the `Name(` call rule (otherwise `if (` reads as a function).
 *
 * ponytail: regex tokenizer, not a parser. Nested interpolation braces, raw string
 * literals (`"""`), and generic-versus-less-than ambiguity are the known ceiling; a real
 * parser is the upgrade path if Pod authoring ever needs it.
 */
import {
  defineLanguage,
  type HighlightTokenClass,
  type TokenRange,
} from "@tanstack/highlight/core";

type Pattern = {
  className: HighlightTokenClass;
  group?: number;
  regex: RegExp;
};

/** First claim wins: a byte already inside a token cannot be re-tokenized. */
function collectPatternRanges(code: string, patterns: readonly Pattern[]): TokenRange[] {
  const ranges: TokenRange[] = [];
  const occupied = new Uint8Array(code.length);
  for (const pattern of patterns) {
    const flags = pattern.regex.flags.includes("g")
      ? pattern.regex.flags
      : `${pattern.regex.flags}g`;
    const regex = new RegExp(pattern.regex.source, flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(code))) {
      const value = pattern.group ? match[pattern.group] : match[0];
      if (!value) {
        if (!match[0].length) regex.lastIndex++;
        continue;
      }
      const start = match.index + (pattern.group ? match[0].indexOf(value) : 0);
      const end = start + value.length;
      let free = true;
      for (let index = start; index < end && free; index++) free = !occupied[index];
      if (!free) continue;
      occupied.fill(1, start, end);
      ranges.push({ start, end, className: pattern.className });
    }
  }
  return ranges;
}

const KEYWORDS =
  "abstract|as|async|await|base|bool|break|byte|case|catch|char|checked|class|const|continue|decimal|default|delegate|do|double|else|enum|event|explicit|extern|false|finally|fixed|float|for|foreach|get|goto|if|implicit|in|init|int|interface|internal|is|lock|long|namespace|new|null|object|operator|out|override|params|private|protected|public|readonly|record|ref|required|return|sbyte|sealed|set|short|sizeof|stackalloc|static|string|struct|switch|this|throw|true|try|typeof|uint|ulong|unchecked|unsafe|ushort|using|var|virtual|void|volatile|when|where|while|yield";

export const csharp = defineLanguage({
  name: "csharp",
  aliases: ["cs", "c#"],
  tokenize: (code) =>
    collectPatternRanges(code, [
      // Comments and strings first: everything after them is inside a claimed span.
      { className: "comment", regex: /\/\/\/[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\//g },
      {
        className: "string",
        regex: /\$?@"(?:""|[^"])*"|\$?"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g,
      },
      // Attributes and preprocessor read as machinery, not code.
      { className: "meta", regex: /^[ \t]*(#\s*\w+[^\n]*)/gm, group: 1 },
      {
        className: "meta",
        regex: /^[ \t]*(\[[A-Z]\w*(?:\.\w+)*(?:\([^\n)]*\))?\])/gm,
        group: 1,
      },
      { className: "keyword", regex: new RegExp(`\\b(?:${KEYWORDS})\\b`, "g") },
      { className: "function", regex: /\b([A-Za-z_]\w*)\s*(?=\()/g, group: 1 },
      // PascalCase before `<`, `.`, or a space then an identifier — a declaration.
      { className: "type", regex: /\b[A-Z]\w*(?=\s*[<.]|\s+[A-Za-z_])/g },
      {
        className: "number",
        regex: /\b(?:0x[\da-f_]+|0b[01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d+)?[dflmu]*)\b/gi,
      },
      { className: "operator", regex: /=>|\?\?=?|[+\-*/%=<>!&|^~?:]+/g },
    ]),
});
