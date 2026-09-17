import type { ReactNode } from "react";

export function Surface({ head, children }: { head?: ReactNode; children: ReactNode }) {
  const body = (
    <div
      data-slot="surface"
      data-surface="page"
      className="flex size-full min-h-0 min-w-0 flex-col"
      style={{ padding: "var(--gutter)" }}
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
        className="sticky top-0 flex size-full min-h-0 min-w-0 flex-col"
        style={{ padding: "var(--gutter)" }}
      >
        {children}
      </div>
    </main>
  );
}
