import { expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { validateRouteGraph, type VerbDecl } from "@pe/agent-contracts";
import { builtinAdmission } from "@pe/kit/route-registry";
import { rankVerbs } from "./situation-band";
import { PageControl } from "./situation-fields";
import { ductsGraph } from "../ducts/graph";

const verb = (extra: Partial<VerbDecl>): VerbDecl => ({
  kind: "command",
  label: "v",
  input: z.object({}),
  review: "none",
  ...extra,
});

test("the band frames the declared primary, else the first model write, keeping the rest in order", () => {
  const verbs = {
    preview: verb({ effect: "query" }),
    apply: verb({ effect: "command" }),
    heal: verb({ effect: "command" }),
  };
  expect(rankVerbs(["preview", "apply", "heal"], verbs)).toEqual(["apply", "preview", "heal"]);
  expect(rankVerbs(["preview", "apply", "heal"], { ...verbs, heal: verb({ primary: true }) })).toEqual(
    ["heal", "preview", "apply"],
  );
  expect(rankVerbs([], verbs)).toEqual([]);
});

test("a bare string field draws no free-text box unless it declares one", () => {
  const draw = (decl: object) =>
    renderToStaticMarkup(
      <PageControl
        id="pod"
        field={{ ...field(z.string().default("")), ...decl } as never}
        value=""
        enabled
        set={() => {}}
      />,
    );
  expect(draw({})).toBe("");
  expect(draw({ editor: "text" })).toContain("<input");
});

test("ducts refreshes from the pane head, never from a stage verb", () => {
  expect(ductsGraph.refresh).toBe("refresh");
  expect(ductsGraph.stages.network!.verbs).not.toContain("refresh");
  const refused = validateRouteGraph({
    ...ductsGraph,
    stages: { network: { ...ductsGraph.stages.network!, verbs: ["refresh"] } },
  } as never);
  expect(refused.map((r) => r.message)).toContain("'refresh' is the pane head's refresh");
});

test("a stale builtin stamp refuses that route with the fix, instead of throwing", () => {
  const stale = { ...ductsGraph, moduleHash: "0".repeat(64) };
  expect(builtinAdmission(stale as never)).toMatch(/hash.*codegen:routes/);
});
