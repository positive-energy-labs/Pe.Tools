import type { CSSProperties, ReactNode } from "react";

export function Surface({
  head,
  columns,
  rows = "minmax(0,1fr)",
  children,
}: {
  head?: ReactNode;
  /** Gutter tracks belong in `columns`; use `SurfaceCell` for every non-handle grid child. */
  columns: string;
  rows?: string;
  children: ReactNode;
}) {
  const grid = {
    padding: "var(--gutter)",
    columnGap: 0,
    rowGap: 0,
    gridTemplateColumns: columns,
    gridTemplateRows: rows,
  } satisfies CSSProperties;
  const body = (
    <div
      data-slot="surface"
      data-surface="page"
      className="grid size-full min-h-0 min-w-0"
      style={grid}
    >
      {children}
    </div>
  );

  return head == null ? (
    body
  ) : (
    <main className="no-scrollbar size-full min-h-0 min-w-0 overflow-y-auto">
      {head}
      <div
        data-slot="surface"
        data-surface="page"
        className="sticky top-0 grid size-full min-h-0 min-w-0"
        style={grid}
      >
        {children}
      </div>
    </main>
  );
}

export function SurfaceCell({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col" style={style}>
      {children}
    </div>
  );
}

export { PaneResizeHandle as SurfaceHandle } from "./pane-resize";
