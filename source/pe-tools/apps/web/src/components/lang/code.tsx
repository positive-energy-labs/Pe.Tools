/**
 * The raw-JSON pane primitive — @tanstack/highlight under a transparent textarea.
 *
 * SHARED across round-1 variants because the primitive itself is not in question
 * (ruled: must use @tanstack/highlight; it is read-only, so editing is the classic
 * overlay). The WRITE MODEL is what varies, and that lives in each variant.
 *
 * `JsonView` is the read-only half; `decorations` (line- or range-anchored, with
 * classNames) is how variants pin trichotomy marks / validation issues to lines.
 * ponytail: no virtualization, no folding — settings files are a few hundred lines;
 * revisit if a profile ever exceeds a few thousand.
 */
import { useMemo, type ComponentProps } from "react";
import { createHighlighter, type HighlightDecoration } from "@tanstack/highlight/core";
import { json } from "@tanstack/highlight/languages/json";

import "./json-editor.css";

const highlighter = createHighlighter({ languages: [json] });

export type { HighlightDecoration };

export function JsonView({
  code,
  decorations,
  lineNumbers,
}: {
  code: string;
  decorations?: readonly HighlightDecoration[];
  lineNumbers?: boolean;
}) {
  const html = useMemo(
    () => highlighter.highlightToHtml(code, { lang: "json", decorations, lineNumbers }),
    [code, decorations, lineNumbers],
  );
  return (
    <div
      data-json-pane=""
      // eslint-disable-next-line react/no-danger -- highlighter output, escaped upstream
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Controlled editor: the highlighted pre is aria-hidden paint and the transparent textarea
 * sits in the same grid cell, sized by the paint. The pane is the one scroller, so the two
 * layers cannot drift. Font metrics MUST match (both inherit the pane's). */
export function JsonEditor({
  value,
  onChange,
  decorations,
  ...textarea
}: {
  value: string;
  onChange: (next: string) => void;
  decorations?: readonly HighlightDecoration[];
} & Omit<ComponentProps<"textarea">, "value" | "onChange">) {
  const html = useMemo(
    // Trailing newline keeps the pre's height in step while the caret sits on a fresh line.
    () => highlighter.highlightToHtml(value + "\n", { lang: "json", decorations }),
    [value, decorations],
  );

  return (
    <div data-json-pane="" data-json-editor="">
      <div data-json-paint="" aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
      <textarea
        data-json-input=""
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        wrap="off"
        {...textarea}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          textarea.onKeyDown?.(e);
          if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
          e.preventDefault();
          // execCommand keeps the edit on the native undo stack; setting value would not.
          document.execCommand("insertText", false, "  ");
        }}
      />
    </div>
  );
}
