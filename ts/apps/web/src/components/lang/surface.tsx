import { createContext, useContext, type ReactNode } from "react";

/** False inside a host pane (Chat's plugin): the pane's split already spaced it, so the route's
 *  own surface adds no second gutter. */
export const SurfaceInset = createContext(true);

export function Surface({ head, children }: { head?: ReactNode; children: ReactNode }) {
  const padding = useContext(SurfaceInset) ? "var(--gutter)" : 0;
  const body = (
    <div
      data-slot="surface"
      data-surface="page"
      className="flex size-full min-h-0 min-w-0 flex-col"
      style={{ padding }}
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
        style={{ padding }}
      >
        {children}
      </div>
    </main>
  );
}
