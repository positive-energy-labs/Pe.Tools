/**
 * Shared prose styling for assistant markdown. Lives apart from aui.tsx so the
 * design-system showcase can render the EXACT chat/markdown look without pulling in
 * the workbench runtime. assistant-ui renders markdown to HTML but doesn't style it,
 * so we use the Tailwind typography plugin (`prose`) tuned to the `--r-*` canon: flat sans
 * headings, nav-blue links (links ARE navigation text), square inline-code chips on the
 * artifact ground, backtick pseudo-content stripped.
 *
 * The --tw-prose-* overrides map EVERY prose element (bold, tables, bullets, quotes, hr —
 * not just the ones restyled below) onto the role tokens, so they stay theme-aware; without
 * them, un-overridden elements use the plugin's light defaults and go near-black in dark.
 */
export const PROSE_CLASS = [
  "prose prose-sm max-w-none leading-normal text-[var(--r-ink)]",
  "[--tw-prose-body:var(--r-ink)] [--tw-prose-headings:var(--r-ink)] [--tw-prose-bold:var(--r-ink)] [--tw-prose-links:var(--r-nav)] [--tw-prose-bullets:var(--r-ink-2)] [--tw-prose-counters:var(--r-ink-2)] [--tw-prose-quotes:var(--r-ink-2)] [--tw-prose-quote-borders:var(--r-line-2)] [--tw-prose-hr:var(--r-line-2)] [--tw-prose-captions:var(--r-ink-2)] [--tw-prose-code:var(--r-ink)] [--tw-prose-th-borders:var(--r-line-2)] [--tw-prose-td-borders:var(--r-line)]",
  "prose-p:my-0 prose-p:mb-[0.45em] last:prose-p:mb-0",
  // Flat heading hierarchy inside answers: chat turns are dense working content, so headings keep
  // the body face and size — weight and spacing carry the structure. (Spectral is a page-title
  // garnish; the PE design language forbids it in dense content, and the density law forbids size jumps.)
  "prose-headings:font-sans prose-headings:text-[1em] prose-headings:font-semibold prose-headings:text-[var(--r-ink)] prose-headings:mt-[0.9em] prose-headings:mb-[0.35em]",
  "prose-a:text-[var(--r-nav)] prose-a:underline prose-a:underline-offset-2",
  // Code = data surface: hard corners per the radius law; machine text sits on the artifact rung.
  "prose-code:rounded-none prose-code:border-[0.5px] prose-code:border-[var(--r-line)] prose-code:bg-[var(--r-artifact)] prose-code:px-[5px] prose-code:py-px prose-code:text-[12.5px] prose-code:font-normal",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-pre:rounded-none prose-pre:border-[0.5px] prose-pre:border-[var(--r-line)] prose-pre:bg-[var(--r-artifact)] prose-pre:text-[var(--r-ink)]",
].join(" ");
