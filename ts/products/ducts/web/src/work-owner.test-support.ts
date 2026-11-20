import { read, hostRead } from "@pe/agent-contracts/route";
import { route, type TypedRoute } from "@pe/web-kernel/route";
import { contract } from "@pe/agent-contracts/handle";
import { scrollBody } from "@pe/web-kernel/route/body";
import type { RouteStateSpec } from "@pe/agent-contracts/route-state";
import { ductsCalcEditsSchema } from "@pe/ducts-contract/duct-inputs";
import { editPatches } from "@pe/ducts-domain/calc/edits";
import { z } from "zod";
import { editMetaSchema, describeInputHistory } from "./calc/input-history.neutral.ts";

/** A peer Work owner from its contract, without importing or exercising the peer's UI. */
export function contractOwner(
  state: RouteStateSpec<z.ZodObject>,
  directory: TypedRoute["data"]["directory"],
) {
  return route({
    key: state.route,
    name: state.title,
    directory,
    fields: {},
    core: read(
      hostRead(
        contract(state.route === "duct-systems" ? "ducts.pricing" : "fans.calc", {
          input: z.object({}),
          data: z.record(z.string(), z.unknown()),
          uses: [],
        }),
      ),
    ),
    panes: {
      fixture: {
        title: "Fixture",
        purpose: "Contract Work owner",
        body: "scroll",
        draw: () => scrollBody(null),
      },
    },
    edits: {
      work: state,
      seed: () => state.schema.parse({}),
      owners: {},
      input: ductsCalcEditsSchema,
      patches: editPatches,
      history: editMetaSchema,
      describe: describeInputHistory,
    },
    layout: { kind: "pane", id: "fixture" },
  });
}
