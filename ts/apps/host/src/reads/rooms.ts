import { workRead } from "./inputs.ts";
import { nativeRead } from "./inputs.ts";

import { executionTargetSchema, roomsRouteState } from "@pe/agent-contracts";
import { read, workScope } from "./evaluator.ts";
import { documentMark } from "./inputs.ts";
import { roomsArgs, roomsData } from "@pe/agent-contracts";
import { planOf } from "./rooms-plan.ts";
export const reads = {
  workspace: read("rooms.workspace", {
    input: roomsArgs.extend({ target: executionTargetSchema }),
    output: roomsData,
    async run(ctx, { target, view }) {
      if (target.kind !== "document") throw Error("Choose a project document");
      await ctx.read(documentMark, target.ref);
      const key = { ...(await ctx.read(workScope, target.ref)), route: "rooms" };
      const work = await ctx.read(workRead("rooms", roomsRouteState.schema), key);
      const snapshot = (
        await ctx.read(nativeRead(view ? "rooms.snapshot" : "rooms.roster"), {
          role: "none",
          request: view ? { view } : {},
          target,
        })
      ).body;
      let trace = null,
        traceError = null,
        plan = null,
        planError = null;
      if (view) {
        try {
          trace = (
            await ctx.read(nativeRead("rooms.trace"), {
              role: "none",
              request: { view },
              target: target,
            })
          ).body;
        } catch (error) {
          traceError = String(error);
        }
        try {
          plan = planOf(
            (
              await ctx.read(nativeRead("revit.context.view-image"), {
                role: "none",
                request: { target: { name: view }, pixelSize: 8000 },
                target,
              })
            ).body,
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
