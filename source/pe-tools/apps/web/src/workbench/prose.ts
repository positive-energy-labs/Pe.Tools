export const PROSE_CLASS = [
  "prose max-w-none text-ink",
  "prose-pe",
  "prose-p:my-0 prose-p:mb-[0.45em] last:prose-p:mb-0",
  "prose-headings:font-sans prose-headings:text-ink prose-headings:mt-[0.9em] prose-headings:mb-[0.35em]",
  "prose-a:underline prose-a:underline-offset-2",
  "prose-code:rounded-none prose-code:border-[0.5px] prose-code:border-line prose-code:px-[5px] prose-code:py-px",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-pre:rounded-none prose-pre:border-[0.5px] prose-pre:border-line prose-pre:text-ink",
  // A table wears MasterTable's cell grammar (see master-table-header.tsx / master-table-body.tsx):
  // `border-separate` + per-cell `border-l`/`first:border-l-0` so no edge doubles, the recess
  // ground and small-caps under the head, hairline row rules, tabular figures. GFM's own
  // `text-align` lands as an inline style and still wins, so a `---:` column stays right-aligned.
  "prose-table:my-2 prose-table:w-full prose-table:border-separate prose-table:border-spacing-0",
  "prose-table:border-[0.5px] prose-table:border-line prose-table:t-small",
  "prose-thead:on-recess",
  "prose-th:t-small prose-th:t-upper prose-th:border-b prose-th:border-l prose-th:border-line",
  "prose-th:px-2 prose-th:py-1 prose-th:text-left prose-th:font-normal prose-th:text-ink",
  "prose-th:first:border-l-0",
  "prose-td:hairline-b-inset prose-td:border-l prose-td:border-line prose-td:first:border-l-0",
  "prose-td:px-2 prose-td:py-1 prose-td:tabular-nums",
  "prose-tr:last:[&_td]:border-b-0",
].join(" ");
