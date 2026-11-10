import type { GraphLayoutState } from "@pe/kit";
/** Layout is device state. Invalid or unavailable storage never prevents a route from opening. */
export function readLayoutState(key: string): GraphLayoutState {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).flatMap(([id, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const { folded, sizes } = value as { folded?: unknown; sizes?: unknown };
        return [
          [
            id,
            {
              ...(typeof folded === "boolean" && { folded }),
              ...(sizes !== null &&
                typeof sizes === "object" &&
                !Array.isArray(sizes) && {
                  sizes: Object.fromEntries(
                    Object.entries(sizes).filter(
                      ([, size]) => typeof size === "number" && Number.isFinite(size) && size > 0,
                    ),
                  ),
                }),
            },
          ],
        ];
      }),
    );
  } catch {
    return {};
  }
}

export function writeLayoutState(key: string, state: GraphLayoutState): void {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch (error) {
    console.warn("ts/apps/web/src/shell/layout-state.ts: fallback after failure", error);
    /* Storage may be disabled. */
  }
}
