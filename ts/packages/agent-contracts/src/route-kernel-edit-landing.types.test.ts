import { expect, it } from "vite-plus/test";
import type { BodyBindings, PaneContext } from "./route-kernel-bodies.ts";
import type { InvocationToken } from "./route-kernel-page.ts";
import { routeVerbJsonSchema } from "./route-kernel-data.ts";
import { builtinData, entries, schemas } from "./route-kernel.fixtures.ts";

const data = {
  ...builtinData,
  verbs: {
    ...builtinData.verbs,
    apply: { ...builtinData.verbs.apply, lands: "landApply" },
  },
} as const;
type Bodies = BodyBindings<typeof data, typeof schemas, typeof entries, string>;
type Pane = PaneContext<typeof data, typeof schemas, typeof entries, "main">;

/** Compile-only: authors can forward, but cannot reconstruct, the mount's edit basis. */
export function editAndLandingTypes(pane: Pane, basis: InvocationToken) {
  if (pane.workBasis) {
    const revision: number | null = pane.workBasis.workRevision;
    const handle = pane.workBasis.token.scope.identity.work;
    pane.verbs.edit({ amount: 1 }, pane.workBasis);
    void [revision, handle];
  }
  // @ts-expect-error Work edits require the basis of the rendered value.
  pane.verbs.edit({ amount: 1 });
  // @ts-expect-error Numeric revisions cannot replace mount authority.
  pane.verbs.edit({ amount: 1 }, { workRevision: 0 });
  // @ts-expect-error Copies lose the nominal invocation authority.
  pane.verbs.edit({ amount: 1 }, { ...basis });
  // @ts-expect-error A route cannot change the revision on an authentic basis.
  basis.workRevision = 12;
  const land: Bodies["landApply"] = {
    slot: "verbs.apply.lands",
    kind: "lands",
    source: { module: "bodies.ts", export: "landApply" },
    run: (result, page) => ({ search: `${page.search}:${result.changed}` }),
  };
  const wrongResult: Bodies["landApply"] = {
    ...land,
    // @ts-expect-error Landing receives the command output, not its input.
    run: (result) => ({ search: String(result.amount) }),
  };
  const wrongPatch: Bodies["landApply"] = {
    ...land,
    // @ts-expect-error Landing must return a typed Page patch.
    run: () => ({ search: 17 }),
  };
  return [land, wrongResult, wrongPatch];
}

it("declares result landing only on native command verbs", () => {
  expect(routeVerbJsonSchema.safeParse(data.verbs.apply).success).toBe(true);
  expect(routeVerbJsonSchema.safeParse({ ...data.verbs.edit, lands: "bad" }).success).toBe(false);
  expect(routeVerbJsonSchema.safeParse({ ...data.verbs.apply, lands: "" }).success).toBe(false);
});

export function committedResultTypes(result: import("./work-journal-door.ts").AcceptedResult) {
  if (result.kind !== "accepted-native") return;
  if (result.outcome === "committed") return result.result;
  // @ts-expect-error Uncommitted native outcomes have no catalog result.
  return result.result;
}

export function uncommittedResultRefusal(
  outcome: Exclude<import("./work-journal-door.ts").NativeOutcome, "committed">,
) {
  const invalid: import("./work-journal-door.ts").AcceptedResult = {
    kind: "accepted-native",
    outcome,
    receiptId: "r",
    // @ts-expect-error None of the four noncommitted native outcomes may carry a result.
    result: {},
  };
  return invalid;
}
