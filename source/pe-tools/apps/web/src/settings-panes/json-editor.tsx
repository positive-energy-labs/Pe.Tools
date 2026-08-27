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
import { useMemo } from "react";
import { createHighlighter, type HighlightDecoration } from "@tanstack/highlight/core";
import { json } from "@tanstack/highlight/languages/json";

import { cn } from "#/lib/utils";
import "./json-editor.css";

const highlighter = createHighlighter({ languages: [json] });

export type { HighlightDecoration };

export function JsonView({
  code,
  decorations,
  lineNumbers,
  className,
}: {
  code: string;
  decorations?: readonly HighlightDecoration[];
  lineNumbers?: boolean;
  className?: string;
}) {
  const html = useMemo(
    () => highlighter.highlightToHtml(code, { lang: "json", decorations, lineNumbers }),
    [code, decorations, lineNumbers],
  );
  return (
    <div
      className={cn("jsonpane face-mono t-value", className)}
      // eslint-disable-next-line react/no-danger -- highlighter output, escaped upstream
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Controlled editor: caret/selection/scroll belong to the textarea; the highlighted
 * pre is aria-hidden paint underneath. Font metrics MUST match (both wear .jsonpane). */
export function JsonEditor({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const html = useMemo(
    // Trailing newline keeps the pre's height in step while the caret sits on a fresh line.
    () => highlighter.highlightToHtml(value + "\n", { lang: "json" }),
    [value],
  );

  return (
    <div className={cn("jsonpane jsonpane--editor face-mono t-value", className)}>
      <div
        aria-hidden
        className="jsonpane-paint"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <textarea
        className="jsonpane-input"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        wrap="off"
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          const paint = e.currentTarget.previousElementSibling;
          if (!(paint instanceof HTMLElement)) return;
          paint.scrollTop = e.currentTarget.scrollTop;
          paint.scrollLeft = e.currentTarget.scrollLeft;
        }}
      />
    </div>
  );
}
