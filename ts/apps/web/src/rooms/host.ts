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
const missingView = z.object({
  evidence: z.object({ issues: z.array(z.object({ code: z.string() })) }),
});
export const reads: {
  workspace: Read<z.output<typeof workspaceArgs>, z.output<typeof roomsData>>;
} = {
  workspace: body(contracts.workspace, async function (ctx, { target, view }) {
    if (target.kind !== "document") throw Error("Choose a project document");
    await ctx.read(documentMark, target.ref);
    const key = { ...(await ctx.read(workScope, target.ref)), route: "rooms" };
    const work = await ctx.read(workRead("rooms", roomsRouteState.schema), key);
    const roster = async () =>
      (await ctx.read(native("rooms.roster"), { request: {}, target })).body;
    const snapshot = view
      ? await ctx.read(native("rooms.snapshot"), { request: { view }, target }).then(
          ({ body }) => body,
          (error: unknown) => {
            if (
              !missingView
                .safeParse(error)
                .data?.evidence.issues.some((issue) => issue.code === "RoomsViewMissing")
            )
              throw error;
            return roster();
          },
        )
      : await roster();
    const selected = snapshot.levels.some((level) => level.views.includes(view)) ? view : "";
    let trace = null,
      traceError = null,
      plan = null,
      planError = null;
    if (selected) {
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
      ...roomsGoal(roomsWork, snapshot, selected),
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
