import { z } from "zod";
import type { WorkPatch, WorkPatches } from "./route-kernel-bodies.ts";

const entry = z.object({ edit: z.object({ value: z.string() }).optional(), count: z.number() });
export const workPatchSchema = z
  .object({
    cells: z.record(z.string(), entry),
    slots: z.partialRecord(z.enum(["a", "b"]), entry).optional(),
    plain: z.object({ a: entry.optional(), b: entry.optional() }),
    title: z.string(),
    scalarEntries: z.record(z.string(), z.string()),
  })
  .readonly();
type Patch = WorkPatch<typeof workPatchSchema>;
// Exercise the schema lookup used by verb, cell, salvage and transition bodies too.
export const acceptedWorkPatches: WorkPatches<
  import("./route-kernel-data.ts").RouteGraphJson & { work: { schema: "fixture" } },
  { fixture: typeof workPatchSchema }
> = [
  { path: ["title"], value: "Schedule" },
  { path: ["cells", "1::1"], value: { count: 1 } },
  { path: ["cells", "1::1", "edit"], value: { value: "reviewed" } },
  { path: ["cells", "1::1", "count"], value: 2 },
  { path: ["cells", "1::1"], op: "delete" },
  { path: ["slots", "a"], value: { count: 1 } },
  { path: ["slots", "b", "edit"], value: { value: "finite" } },
  { path: ["slots", "a", "count"], value: 2 },
  { path: ["slots", "b"], op: "delete" },
  { path: ["slots"], value: { a: { count: 1 } } },
  { path: ["plain"], value: { a: { count: 1 } } },
  { path: ["scalarEntries", "key"], value: "value" },
  { path: ["scalarEntries", "key"], op: "delete" },
];
// Each negative type witness is also refused by admittedWorkPatches at runtime.
export const rejectedWorkPatches = [
  // @ts-expect-error A leaf keeps its value type.
  { path: ["cells", "1::1", "count"], value: "two" } satisfies Patch,
  // @ts-expect-error Unknown entry fields are refused.
  { path: ["cells", "1::1", "missing"], value: 1 } satisfies Patch,
  // @ts-expect-error Unknown top-level fields are refused.
  { path: ["missing", "1::1"], op: "delete" } satisfies Patch,
  // @ts-expect-error Scalar top-level fields have no keyed patch door.
  { path: ["title", "length"], op: "delete" } satisfies Patch,
  // @ts-expect-error Deletion cannot also replace a value.
  { path: ["cells", "1::1"], op: "delete", value: { count: 1 } } satisfies Patch,
  // @ts-expect-error Finite record keys retain their enum.
  { path: ["slots", "nope"], value: { count: 1 } } satisfies Patch,
  // @ts-expect-error Finite record deletion retains its enum too.
  { path: ["slots", "nope"], op: "delete" } satisfies Patch,
  // @ts-expect-error Finite entry replacement retains its value type.
  { path: ["slots", "a"], value: { count: "one" } } satisfies Patch,
  // @ts-expect-error Finite entry fields retain their value type.
  { path: ["slots", "a", "count"], value: "one" } satisfies Patch,
  // @ts-expect-error Optional object fields do not make an object a record.
  { path: ["plain", "a"], value: { count: 1 } } satisfies Patch,
  // @ts-expect-error Plain object entry fields are not keyed patch paths.
  { path: ["plain", "a", "count"], value: 1 } satisfies Patch,
  // @ts-expect-error Scalar record entries have no object fields.
  { path: ["scalarEntries", "key", "length"], value: 1 } satisfies Patch,
];
