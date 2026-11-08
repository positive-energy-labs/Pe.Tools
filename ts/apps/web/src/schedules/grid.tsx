import { PreviewAction } from "@pe/kit/lang/write-action";
import { useState } from "react";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { scheduleGridRouteState, scheduleReadingSchema } from "@pe/agent-contracts";
import { ScheduleGridWorkspace, type ScheduleGridState } from "../route/schedules/workspace";
import type { SchedulesDrawContext } from "./route";
import { namesOf } from "../route/typed-route";

export function SchedulesGrid({ ctx }: { ctx: SchedulesDrawContext }) {
  const [failure, setFailure] = useState<string | null>(null);
  const data = ctx.value.value,
    shown = data?.reading;
  const page = ctx.page.read();
  const refusal = !ctx.cells.ready ? ctx.cells.refusal : data?.editRefusal;
  const snapshot = shown ? scheduleReadingSchema.parse(shown).snapshot : null;
  const state: ScheduleGridState = {
    at: (key) => {
      const cell = ctx.cells.at(["cells", key]);
      return {
        ...cell,
        refusal: refusal ?? cell.refusal,
        stage: (value, history) =>
          refusal ? Promise.resolve({ message: refusal }) : cell.stage(value, history),
        clear: (history) => (refusal ? Promise.resolve({ message: refusal }) : cell.clear(history)),
        transitions: (history) => (refusal ? [] : cell.transitions(history)),
      };
    },
    slice: ctx.cells.doc ? scheduleGridRouteState.schema.parse(ctx.cells.doc) : null,
    revision: ctx.cells.basis?.workRevision ?? null,
    hydrated: ctx.value.value !== undefined,
    readPrompt: namesOf(page.workspaceId).length
      ? ctx.cells.doc ? "Read schedule" : "Start this schedule Work, then Read schedule"
      : "Choose schedule in the header, then Read schedule",
    apply: async (patches) => {
      if (refusal) return { code: "not-ready", message: refusal };
      const result = await ctx.cells.edit(patches, { label: "Edit schedule cells" });
      return result ? { code: "not-ready", message: result.message } : null;
    },
    documentScope: shown
      ? { bridgeSessionId: shown.target.session, openDocumentId: shown.target.openId }
      : undefined,
    snapshot,
    refused: data?.outcome.refused ?? {},
    freshness: ctx.value.current ? "current" : "changed",
    table: {
      ...page.table,
      sorts: [...page.table.sorts],
      hiddenColumns: [...page.table.hiddenColumns],
    },
    setTable: (table) =>
      ctx.page.pose(
        {
          table: {
            query: table.query,
            sorts: table.sorts,
            hiddenColumns: table.hiddenColumns ?? [],
          },
        },
        "named",
      ),
    cell: page.cell,
    locate: (cell) => ctx.page.pose({ cell }, "named"),
  };
  const run = async (id: string) => {
    try {
      setFailure(null);
      await ctx.write(id).run();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <>
      <Button label="Read schedule" onClick={() => run("read")}>
        Read schedule
      </Button>
      <Button label="Bind schedule" onClick={() => run("bind")}>
        Bind schedule
      </Button>
      <PreviewAction handle={ctx.write("push")} label="Apply cells" />
      {!ctx.value.current && (data || ctx.value.status === "pending") && (
        <OutcomeLine kind="advisory" label="Schedule reading" says={ctx.value.reason} />
      )}
      {failure && <OutcomeLine kind="error" label="Schedule grid" says={failure} />}
      {data?.outcome.readbackError && (
        <OutcomeLine kind="error" label="Schedule readback" says={data.outcome.readbackError} />
      )}
      {!data && !ctx.value.current && ctx.value.status !== "pending" ? (
        <OutcomeLine kind="error" label="Schedule reading unavailable" says={ctx.value.reason} />
      ) : (
        <ScheduleGridWorkspace state={state} onRefused={setFailure} onHidden={setFailure} />
      )}
    </>
  );
}
