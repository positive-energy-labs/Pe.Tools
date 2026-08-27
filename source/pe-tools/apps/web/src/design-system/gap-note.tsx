/** A visible design-system gap: exhibit testimony, not product grammar. */
export function GapNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="face-mono t-caption max-w-[86ch] border-l border-dashed border-[var(--r-line-2)] pl-2 text-[var(--r-ink-2)]">
      <span className="text-[var(--r-caution)]">gap · </span>
      {children}
    </p>
  );
}
