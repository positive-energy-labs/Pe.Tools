import { expect, test } from "vite-plus/test";
import { z } from "zod";
import type { BodyBindings, PaneContext } from "./route-kernel-bodies.ts";
import { builtinData, schemas, entries } from "./route-kernel.fixtures.ts";
const data = {
  ...builtinData,
  verbs: { ...builtinData.verbs, edit: { ...builtinData.verbs.edit, describe: "describeEdit" } },
} as const;
type Describe = BodyBindings<typeof data, typeof schemas, typeof entries, string>["describeEdit"];
export const describe: Describe = {
  slot: "verbs.edit.describe",
  kind: "describe",
  source: { module: "test.ts", export: "describe" },
  run: (input, ctx) => {
    const amount: number = input.amount;
    // @ts-expect-error No captured evidence or invocation authority in description context.
    void ctx.captures;
    // @ts-expect-error Only declared Page dependencies are available.
    void ctx.page.hidden;
    // @ts-expect-error Only declared Work dependencies are available.
    void ctx.work.hidden;
    // @ts-expect-error Only declared readings are available.
    void ctx.readings.hidden;
    return { label: `Amount ${amount}` };
  },
};
export const asyncDescription: Describe = {
  ...describe,
  // @ts-expect-error Description must synchronously return its label.
  run: async () => ({ label: "late" }),
};
export const numberDescription: Describe = {
  ...describe,
  // @ts-expect-error Numeric labels cannot be persisted.
  run: () => ({ label: 42 }),
};
export const untypedMeta: Describe = {
  ...describe,
  // @ts-expect-error A route without a history-detail schema sends no meta.
  run: () => ({ label: "Row edit", meta: { row: "row-1" } }),
};
test("description slot keeps its input-first synchronous signature", () => {
  expect(describe.slot).toBe("verbs.edit.describe");
});

const typedData = { ...data, historyDetail: "detail" } as const;
const typedSchemas = { ...schemas, detail: z.strictObject({ row: z.string() }) };
type TypedDescribe = BodyBindings<
  typeof typedData,
  typeof typedSchemas,
  typeof entries,
  string
>["describeEdit"];
export const typedDescribe: TypedDescribe = {
  ...describe,
  run: (_input, _ctx) => ({ label: "Row edit", meta: { row: "row-1" } }),
};
export const wrongMeta: TypedDescribe = {
  ...typedDescribe,
  // @ts-expect-error The declared metadata schema requires a string row.
  run: () => ({ label: "Row edit", meta: { row: 42 } }),
};
function immutableHistory(
  ctx: PaneContext<
    typeof typedData,
    typeof typedSchemas,
    typeof entries,
    keyof typeof typedData.panes
  >,
) {
  const entry = ctx.history?.entries[0];
  if (entry?.detail === "available") {
    const row: string = entry.meta.row;
    void row;
    // @ts-expect-error History detail is a readonly canonical projection.
    entry.meta.row = "changed";
  }
  // @ts-expect-error Routes cannot append to canonical history.
  ctx.history?.entries.push({});
}
void immutableHistory;

type MetaRefusalCode = Exclude<
  Extract<
    import("./work-journal-door.ts").WorkWriteOutcome,
    { kind: "refused" }
  >["refusal"]["code"],
  import("./families.ts").FamiliesRefusalCode | "stale_revision" | undefined
>;
type Code = import("./route-state.ts").HistoryMetaRefusalCode;
const metaRefusalsAreTheList: [MetaRefusalCode] extends [Code]
  ? [Code] extends [MetaRefusalCode]
    ? true
    : false
  : false = true;
void metaRefusalsAreTheList;
