/**
 * Shared prose styling for assistant markdown. Lives apart from aui.tsx so the
 * design-system showcase can render the EXACT chat/markdown look without pulling in
 * the workbench runtime. assistant-ui renders markdown to HTML but doesn't style it,
 * so we use the Tailwind typography plugin (`prose`) tuned to the Lens palette: serif
 * headings, PE-blue links, inline-code pills on paper-2, backtick pseudo-content stripped.
 *
 * The --tw-prose-* overrides map EVERY prose element (bold, tables, bullets, quotes, hr —
 * not just the ones restyled below) onto the Lens palette, so they stay theme-aware; without
 * them, un-overridden elements use the plugin's light defaults and go near-black on the dark Lens.
 *
 * The var()s below (--basalt, --pe-blue, --paper-2, --line, --slate, --font-display…) are the
 * Lens vocabulary, now aliased onto the global shadcn base in styles.css — so PROSE_CLASS is
 * self-contained and theme-aware anywhere, no `.lens-frame` ancestor required.
 */
export const PROSE_CLASS = [
  "prose prose-sm max-w-none leading-relaxed text-[var(--basalt)]",
  "[--tw-prose-body:var(--basalt)] [--tw-prose-headings:var(--basalt)] [--tw-prose-bold:var(--basalt)] [--tw-prose-links:var(--pe-blue)] [--tw-prose-bullets:var(--slate)] [--tw-prose-counters:var(--slate)] [--tw-prose-quotes:var(--slate)] [--tw-prose-quote-borders:var(--line-2)] [--tw-prose-hr:var(--line-2)] [--tw-prose-captions:var(--muted-foreground)] [--tw-prose-code:var(--basalt)] [--tw-prose-th-borders:var(--line-2)] [--tw-prose-td-borders:var(--line)]",
  "prose-p:my-0 prose-p:mb-[0.6em] last:prose-p:mb-0",
  "prose-headings:font-[var(--font-display)] prose-headings:font-semibold prose-headings:text-[var(--basalt)]",
  "prose-a:text-[var(--pe-blue)] prose-a:underline prose-a:underline-offset-2",
  "prose-code:rounded prose-code:border-[0.5px] prose-code:border-[var(--line)] prose-code:bg-[var(--paper-2)] prose-code:px-[5px] prose-code:py-px prose-code:text-[12.5px] prose-code:font-normal",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-pre:rounded-[7px] prose-pre:border-[0.5px] prose-pre:border-[var(--line)] prose-pre:bg-[var(--paper-2)] prose-pre:text-[var(--basalt)]",
].join(" ");
