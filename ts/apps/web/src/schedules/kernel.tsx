import type { z } from "zod";
import { useState, type ReactNode } from "react";
import {
  scheduleReadingSchema,
  scheduleCatalogSchema,
  scheduleGridRouteState,
} from "@pe/agent-contracts";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { RouteModule } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import { identityCodecs } from "../shell/page-port";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { ScheduleGridWorkspace, type ScheduleGridState } from "../route/schedules/workspace";
import { schedulesKernelSources } from "./kernel-sources";
import {
  schedulesData,
  schemas,
  entries,
  neutralBodies,
  source,
  scheduleIdentity,
} from "./neutral";
export { schedulesData, scheduleIdentity } from "./neutral";
export const bodies = {
  ...neutralBodies,
  grid: {
    slot: "panes.grid.body",
    kind: "pane",
    source,
    run: (ctx) => {
      const p = ctx.page.read();
      const fresh = ctx.readings.snapshot.current ? ctx.readings.snapshot : ctx.readings.retained;
      const shown = fresh.value;
      const target = ctx.workBasis?.token.scope.identity.target;
      const native =
        target?.kind === "document" &&
        shown?.target.session === target.ref.session &&
        shown?.target.openId === target.ref.openId;
      const rawWork: unknown = ctx.work;
      const work = rawWork ? scheduleGridRouteState.schema.parse(rawWork) : null;
      const state: ScheduleGridState = {
        slice: work,
        revision: ctx.workBasis?.workRevision ?? null,
        hydrated: !!ctx.work,
        apply: (patches) =>
          new Promise((resolve) => {
            if (!ctx.workBasis) {
              resolve({ code: "not-ready", message: "Schedule Work is unavailable" });
              return;
            }
            try {
              const observation = ctx.verbs.edit(schemas.edit.parse({ patches }), ctx.workBasis);
              if (!("subscribe" in observation)) {
                resolve({ code: "not-ready", message: observation.reason });
                return;
              }
              observation.subscribe(
                (outcome) => {
                  if (outcome.kind === "accepted") resolve(null);
                  if (outcome.kind === "refused")
                    resolve({
                      code: "not-ready",
                      message: outcome.refusal.error,
                    });
                },
                () => {},
              );
            } catch (error) {
              resolve({
                code: "not-ready",
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }),
        execute: async () => ({
          code: "not-ready",
          message: "Use Read schedule beside the schedule name",
        }),
        documentScope: shown
          ? { bridgeSessionId: shown.target.session, openDocumentId: shown.target.openId }
          : undefined,
        nativeObservation: {
          scope: shown
            ? { document: native ? shown.target : null, source: native ? "native" : "saved" }
            : null,
        },
        snapshot: shown ? scheduleReadingSchema.parse(shown).snapshot : null,
        catalog: ctx.readings.catalog.value
          ? scheduleCatalogSchema.parse(ctx.readings.catalog.value)
          : null,
        busy: null,
        refused: ctx.readings.outcome.value?.refused ?? {},
        onFocus: { grid: () => {} },
        freshness: fresh.current ? "current" : "changed",
        table: schemas.table.parse(p.table),
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
        cell: "",
        locate: () => {},
      };
      return (
        <>
          {(ctx.readings.catalog.value?.schedules ?? []).map((row) => (
            <Button
              key={row.scheduleId}
              label={`Read ${row.name}`}
              onClick={() => ctx.verbs.read({ scheduleId: row.scheduleId, maxRows: 200 })}
            >
              {row.name}
            </Button>
          ))}
          {!fresh.current && (
            <OutcomeLine
              kind="error"
              label="Schedule reading"
              says={fresh.reason ?? "Reading is unavailable"}
            />
          )}
          <Button label="Bind schedule" onClick={() => ctx.verbs.bind({})}>
            Bind schedule
          </Button>
          <Button label="Apply cells" onClick={() => ctx.verbs.push({})}>
            Apply cells
          </Button>
          {ctx.readings.outcome.value?.readbackError && (
            <OutcomeLine
              kind="error"
              label="Schedule readback"
              says={ctx.readings.outcome.value.readbackError}
            />
          )}
          <Grid state={state} />
        </>
      );
    },
  },
} satisfies BodyBindings<typeof schedulesData, typeof schemas, typeof entries, ReactNode>;
export const module = {
  data: schedulesData,
  schemas,
  entries,
  bodies,
  sources: schedulesKernelSources(),
  identities: { local: identityCodecs.local },
  codecs: {
    subject: {
      encode: (value: z.output<typeof schemas.subject>) => value ?? "",
      decode: (text: string) => ({
        ok: true as const,
        value: text
          ? scheduleIdentity(
              identityCodecs.local.decode(text).ok
                ? identityCodecs.local.parts(schemas.subject.parse(text)!).subject
                : text,
            )
          : null,
      }),
    },
    json: {
      encode: JSON.stringify,
      decode: (text: string) => {
        try {
          return { ok: true as const, value: JSON.parse(text) };
        } catch {
          return { ok: false as const, reason: "Invalid JSON" };
        }
      },
    },
  },
} satisfies Omit<
  RouteModule<typeof schedulesData, typeof schemas, typeof entries, ReactNode>,
  "artifact"
>;

function Grid({ state }: { state: ScheduleGridState }) {
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <>
      {failure && <OutcomeLine kind="error" label="Schedule grid" says={failure} />}
      <ScheduleGridWorkspace state={state} onRefused={setFailure} onHidden={setFailure} />
    </>
  );
}
