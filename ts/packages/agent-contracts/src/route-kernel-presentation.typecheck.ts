import type { BodyBindings } from "./route-kernel-bodies.ts";
import { builtinData, schemas, entries } from "./route-kernel.fixtures.ts";
const data = {
  ...builtinData,
  verbs: {
    ...builtinData.verbs,
    apply: {
      ...builtinData.verbs.apply,
      present: "presentApply",
      deps: { page: ["density"], work: ["amount"], readings: ["total"] },
    },
  },
} as const;
type Present = BodyBindings<typeof data, typeof schemas, typeof entries, string>["presentApply"];
export const present: Present = {
  slot: "verbs.apply.present",
  kind: "present",
  source: { module: "test.ts", export: "present" },
  run: (_result, evidence) => {
    const amount: number = evidence.work.amount;
    const density: number = evidence.page.density;
    const total = evidence.readings.total;
    // @ts-expect-error Only declared readings are visible.
    void evidence.readings.roster;
    // @ts-expect-error Only declared Work fields are visible.
    void evidence.work.note;
    // @ts-expect-error Only declared Page fields are visible.
    void evidence.page.search;
    // @ts-expect-error Evidence is immutable.
    evidence.work.amount = 2;
    // @ts-expect-error Reading values are immutable too.
    if (total.current) total.value.total = 2;
    // @ts-expect-error No invocation authority is exposed.
    void evidence.workBasis;
    // @ts-expect-error Captures are not declared presentation dependencies.
    void evidence.captures;
    return `${amount} at ${density}`;
  },
};
export const asyncPresenter: Present = {
  ...present,
  // @ts-expect-error Presenters must return synchronously.
  run: async () => "late",
};
