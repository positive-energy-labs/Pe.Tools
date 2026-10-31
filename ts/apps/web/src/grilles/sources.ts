import type { GrillesPage } from "./graph";
import { enumerate, solve } from "./math";

export function solvePage(page: GrillesPage) {
  const rows = page.rows.map((row) => ({ ...solve(row), id: row.id }));
  const active = rows.find((row) => row.id === page.row) ?? rows[0];
  return { rows, active, field: active ? enumerate(active) : [] };
}

export const grillesSources = {
  "grilles.solve": {
    kind: "derive" as const,
    derive: ({ args }: { args: unknown }) => solvePage(args as GrillesPage),
  },
};
