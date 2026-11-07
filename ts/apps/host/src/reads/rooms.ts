import { z } from "zod";
import { documentRefSchema, executionTargetSchema, roomsRouteState } from "@pe/agent-contracts";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { leaf, read } from "./evaluator.ts";
import { documentMark, workScope, workValue } from "./ducts-inputs.ts";
import { roomsArgs, roomsData } from "@pe/agent-contracts";
import { planOf } from "./rooms-plan.ts";
const native = leaf(
  "rooms.native",
  z.object({
    key: z.enum(["rooms.roster", "rooms.snapshot", "rooms.trace", "revit.context.view-image"]),
    request: z.record(z.string(), z.unknown()),
    target: documentRefSchema,
  }),
  z.object({ body: z.unknown(), version: z.string().nullable() }),
  false,
);
export const reads = {
  workspace: read("rooms.workspace", {
    input: roomsArgs.extend({ target: executionTargetSchema }),
    output: roomsData,
    async run(ctx, { target, view }) {
      if (target.kind !== "document") throw Error("Choose a project document");
      await ctx.read(documentMark, target.ref);
      const key = { ...(await ctx.read(workScope, target.ref)), route: "rooms" };
      const work = workValue.parse(await ctx.work("rooms", key));
      const snapshot = nativeResponseSchema("rooms.snapshot").parse(
        (
          await ctx.read(native, {
            key: view ? "rooms.snapshot" : "rooms.roster",
            request: view ? { view } : {},
            target: target.ref,
          })
        ).body,
      );
      let trace = null,
        traceError = null,
        plan = null,
        planError = null;
      if (view) {
        try {
          trace = nativeResponseSchema("rooms.trace").parse(
            (await ctx.read(native, { key: "rooms.trace", request: { view }, target: target.ref }))
              .body,
          );
        } catch (error) {
          traceError = String(error);
        }
        try {
          plan = planOf(
            nativeResponseSchema("revit.context.view-image").parse(
              (
                await ctx.read(native, {
                  key: "revit.context.view-image",
                  request: { target: { name: view }, pixelSize: 8000 },
                  target: target.ref,
                })
              ).body,
            ),
          );
        } catch (error) {
          planError = String(error);
        }
      }
      return {
        roomsWork: roomsRouteState.schema.parse(work?.doc ?? {}),
        handle: work ? { key, revision: work.revision } : null,
        snapshot,
        trace,
        traceError,
        plan,
        planError,
      };
    },
  }),
};
export const leaves = {
  "rooms.native": (
    args: unknown,
    services: import("./evaluator.ts").InputPort,
  ) => services.take("native", args),
};
