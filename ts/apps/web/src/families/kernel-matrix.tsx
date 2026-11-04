import { applyTally, applyOutcome } from "./apply-outcome";
import { refuse } from "#/route/refusal";
import { useRef } from "react";
import {
  actionReceiptListDecoder,
  familiesRouteState,
  familyCellAddress,
  type FamilyCellState,
} from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import type { PaneContext } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import { familiesData, familiesSchemas, familiesEntries } from "./neutral";
import { TypeGrid } from "./pivot-grid";
import { useLiveCells } from "./matrix-columns";
import { matrixModel, buildPivot } from "./kernel-matrix-model";
import { useMeasuredParse } from "#/host/measured-parse";
type Context = PaneContext<
  typeof familiesData,
  typeof familiesSchemas,
  typeof familiesEntries,
  "main"
>;
export function FamiliesKernelMatrix({ ctx }: { ctx: Context }) {
  const scroller = useRef<HTMLDivElement>(null);
  const work = ctx.work ? familiesRouteState.schema.parse(ctx.work) : null;
  const receipts = actionReceiptListDecoder().parse(ctx.readings.receipts.value ?? []);
  const shown = ctx.readings.matrix.value;
  const families = shown ? familiesSchemas.observation.parse(shown).result.families : [];
  const { rows, params } = matrixModel(families);
  const pivot = buildPivot(rows, params, families);
  const ref = ctx.workBasis?.token.scope.identity.target;
  const scope =
    ref?.kind === "document"
      ? { bridgeSessionId: ref.ref.session, openDocumentId: ref.ref.openId }
      : undefined;
  const parse = useMeasuredParse(families, scope);
  const filter = work?.scope.edit?.value ?? {
    categoryNames: [],
    familyNames: [],
    placementScope: "AllLoaded" as const,
  };
  const catalog = ctx.readings.catalog.value?.families ?? [];
  const categories = [...new Set(catalog.flatMap((f) => (f.categoryName ? [f.categoryName] : [])))];
  const settle = (observation: ReturnType<Context["verbs"]["revert"]>) =>
    new Promise<ReturnType<typeof refuse> | null>((resolve) =>
      observation.subscribe(
        (outcome) => {
          if (outcome.kind === "accepted") resolve(null);
          if (outcome.kind === "refused")
            resolve(refuse("not-ready", outcome.refusal.error ?? "Work refused"));
        },
        () => {},
      ),
    );
  const live = useLiveCells((work?.cells ?? {}) as Record<string, FamilyCellState>, {
    segment: "cells",
    revision: ctx.workBasis?.workRevision ?? null,
    async write(patches) {
      if (!ctx.workBasis) return refuse("not-ready", "Work unavailable");
      const result = ctx.verbs.writeCells(patches, ctx.workBasis);
      return "subscribe" in result ? settle(result) : refuse("not-ready", result.reason);
    },
  });
  const focus = ctx.page.read().focus;
  let landed: { row: number; col: number; n: number } | null = null;
  if (focus) {
    const address = familyCellAddress(focus);
    landed = {
      row: pivot.pivotRows.findIndex((r) => r.name === address.parameter),
      col: rows.findIndex(
        (r) => r.familyName === address.familyName && r.typeName === address.typeName,
      ),
      n: 1,
    };
  }
  return (
    <>
      <div role="group" aria-label="Family scope">
        {categories.map((category) => (
          <Button
            key={category}
            label={`Choose ${category}`}
            onClick={() =>
              ctx.workBasis &&
              ctx.verbs.pick(
                { ...filter, categoryNames: [category], familyNames: [] },
                ctx.workBasis,
              )
            }
          >
            {category}
          </Button>
        ))}
        {catalog
          .filter(
            (f) =>
              !filter.categoryNames.length || filter.categoryNames.includes(f.categoryName ?? ""),
          )
          .map((family) => (
            <Button
              key={family.familyId}
              label={`Choose ${family.familyName}`}
              onClick={() =>
                ctx.workBasis &&
                ctx.verbs.pick({ ...filter, familyNames: [family.familyName] }, ctx.workBasis)
              }
            >
              {family.familyName}
            </Button>
          ))}
        <Button
          label="Read families"
          onClick={() => {
            const readId = crypto.randomUUID();
            ctx.page.pose({ readId }, "named");
            ctx.verbs.read({ filter, readId });
          }}
        >
          Read families
        </Button>
        <Button
          label="Stop family read"
          onClick={() =>
            ctx.verbs.stop({
              readId:
                ctx.page.read().readId ||
                shown?.progress?.runId ||
                "00000000-0000-4000-8000-000000000000",
            })
          }
        >
          Stop
        </Button>
        <Button label="Apply families" onClick={() => ctx.verbs.apply({})}>
          Apply families
        </Button>
      </div>
      {!ctx.readings.matrix.current && (
        <OutcomeLine kind="advisory" label="Family read" says={ctx.readings.matrix.reason} />
      )}
      {receipts
        .filter((r) => r.key === "families.apply")
        .map((r) => {
          const outcome = applyOutcome(r, filter.familyNames);
          const tally = r.state === "succeeded" ? applyTally(r) : null;
          return (
            <OutcomeLine
              key={r.id}
              kind={outcome ? "error" : "advisory"}
              label="Family receipt"
              says={outcome?.message ?? `${tally?.converged ?? 0} families converged`}
            />
          );
        })}
      <TypeGrid
        rows={pivot.pivotRows}
        types={rows}
        families={pivot.pivotFamilies}
        scroller={scroller}
        landed={landed}
        edit={{
          live,
          params: new Map(params.map((p) => [p.key, p])),
          readOnly: !ctx.readings.matrix.current || !work,
          parse,
          propose: async (address, value, current) => {
            if (!ctx.workBasis) return refuse("not-ready", "Work unavailable");
            const result = ctx.verbs.edit({ address, value, current }, ctx.workBasis);
            if (!("subscribe" in result)) return refuse("not-ready", result.reason);
            return settle(result);
          },
        }}
      />
    </>
  );
}
