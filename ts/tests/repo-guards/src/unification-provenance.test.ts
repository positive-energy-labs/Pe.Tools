import { expect, test } from "vite-plus/test";
import { boundaryCensus } from "./unification-2-census.ts";

test("public pane provenance does not permit legacy or untyped fixture access", () => {
  const actual = boundaryCensus({
    "ts/apps/web/src/example/panes.tsx": `
      import type { PaneContext } from "@pe/agent-contracts";
      type Body = PaneContext<Graph, Schemas, Entries, "pane">;
      const provenance = (body: Pick<Body, "fixture">) => body.fixture;
      const legacy = (owner: LegacyOwner) => owner.fixture;
      const untyped = (body: any) => body.fixture;
    `,
    "ts/apps/web/src/example/disguise.ts": `
      import type { PaneContext } from "./legacy-owner";
      const disguised = (body: PaneContext) => body.fixture;
    `,
  });
  expect(actual.fixtureMode).toHaveLength(3);
});

test("admitted Place and router facades still reject private imports and reexports", () => {
  const sources = {
    "ts/apps/web/src/shell/owner.ts": "export const owner = {};",
    "ts/apps/web/src/routes/__root.tsx": 'import { owner } from "../shell/owner";',
    "ts/apps/web/src/route/builtin-routes.tsx": 'import { Route } from "../routes/__root";',
    "ts/apps/web/src/router.tsx": 'import { BuiltinRoute } from "./route/builtin-routes";',
    "ts/apps/web/src/example/body.tsx": 'import { owner } from "../shell/owner";',
  };
  expect(boundaryCensus(sources).rawPageImports).toHaveLength(1);
  expect(
    boundaryCensus({
      ...sources,
      "ts/apps/web/src/route/builtin-routes.tsx": 'export { owner } from "../shell/owner";',
      "ts/apps/web/src/router.tsx": 'import { owner } from "./shell/owner";',
    }).rawPageImports,
  ).toHaveLength(3);
});
