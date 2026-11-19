import { native } from "@pe/agent-contracts/handle";
import * as contracts from "./contract.ts";
import { body } from "@pe/host-internal/read-graph";
import { z } from "zod";
import type { Read } from "@pe/host-internal/read-graph";
import { workRead } from "@pe/host-internal/reads/work";

import { executionTargetSchema, roomsRouteState } from "@pe/agent-contracts";
import { workScope, documentMark } from "@pe/host-internal/read-graph";
import { roomsArgs, roomsData } from "@pe/agent-contracts";
import { planOf } from "./rooms-plan.ts";
import { roomsGoal, traceRefusal } from "./goal.ts";
const workspaceArgs = roomsArgs.extend({ target: executionTargetSchema });
export const reads: { workspace: Read<z.output<typeof workspaceArgs>, z.output<typeof roomsData>> } = {
  workspace: body(contracts.workspace, async function(ctx, { target, view }) {
      if (target.kind !== "document") throw Error("Choose a project document");
      await ctx.read(documentMark, target.ref);
      const key = { ...(await ctx.read(workScope, target.ref)), route: "rooms" };
      const work = await ctx.read(workRead("rooms", roomsRouteState.schema), key);
      const snapshot = (
        await ctx.read(native(view ? "rooms.snapshot" : "rooms.roster"), {
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
            await ctx.read(native("rooms.trace"), {
              request: { view },
              target: target,
            })
          ).body;
        } catch (error) {
          console.warn("rooms.trace", view, error);
          traceError = traceRefusal(String(error));
        }
        try {
          plan = planOf(
            (
              await ctx.read(native("revit.context.view-image"), {
                request: { target: { name: view }, pixelSize: 8000 },
                target,
              })
            ).body,
          );
        } catch (error) {
          planError = String(error);
        }
      }
      const roomsWork = roomsRouteState.schema.parse(work?.doc ?? {});
      return {
        ...roomsGoal(roomsWork, snapshot, view),
        roomsWork,
        handle: work ? { key, revision: work.revision } : null,
        snapshot,
        trace,
        traceError,
        plan,
        planError,
      };
    }),
};
