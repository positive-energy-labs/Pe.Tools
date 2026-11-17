import { route, read, type TypedRoute } from "@pe/web/route";
import { hostRead } from "@pe/web/host-read";
import { contract, handle } from "@pe/agent-contracts/handle";
import type { RouteStateSpec } from "@pe/agent-contracts/route-state";
import { ductsCalcEditsSchema } from "@pe/agent-contracts";
import { editPatches } from "@pe/ducts-domain/calc/edits";
import { z } from "zod";
import { editMetaSchema, describeInputHistory } from "./calc/input-history.neutral.ts";

/** A peer Work owner from its contract, without importing or exercising the peer's UI. */
export function contractOwner(state: RouteStateSpec<z.ZodObject>, directory: TypedRoute["data"]["directory"]) {
  return route({
    key: state.route, name: state.title, directory, fields: {},
    core: read(hostRead(contract(state.route === "ducts" ? "ducts.pricing" : "fans.sheet", {
      input: z.object({}), data: z.record(z.string(), z.unknown()), uses: [],
    }))),
    panes: { fixture: { title: "Fixture", purpose: "Contract Work owner", body: "scroll", draw: () => null } },
    edits: { work: state, seed: () => state.schema.parse({}), owners: {}, input: ductsCalcEditsSchema,
      patches: editPatches, history: editMetaSchema, describe: describeInputHistory },
    verbs: { losses: { handle: handle("sheet.apply"), label: "Write" } },
    band: ["losses"],
    layout: { kind: "pane", id: "fixture" },
  });
}
