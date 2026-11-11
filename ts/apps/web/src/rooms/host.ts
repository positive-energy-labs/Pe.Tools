import { z } from "zod";
import type { Read } from "@pe/host/read-graph";
import { workRead } from "@pe/host/reads/inputs";

import { executionTargetSchema, roomsRouteState } from "@pe/agent-contracts";
import { read, workScope, documentMark } from "@pe/host/read-graph";
import { roomsArgs, roomsData } from "@pe/agent-contracts";
import { planOf } from "./rooms-plan.ts";
import { roomsGoal } from "./goal.ts";
const workspaceArgs = roomsArgs.extend({ target: executionTargetSchema });
export const reads: { workspace: Read<z.output<typeof workspaceArgs>, z.output<typeof roomsData>> } = {
  workspace: read("rooms.workspace", {
    input: workspaceArgs,
    output: roomsData,
    async run(ctx, { target, view }) {
      if (target.kind !== "document") throw Error("Choose a project document");
      await ctx.read(documentMark, target.ref);
      const key = { ...(await ctx.read(workScope, target.ref)), route: "rooms" };
      const work = await ctx.read(workRead("rooms", roomsRouteState.schema), key);
      const snapshot = (
        await ctx.native(view ? "rooms.snapshot" : "rooms.roster", {
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
            await ctx.native("rooms.trace", {
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
              await ctx.native("revit.context.view-image", {
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
    },
  }),
};
