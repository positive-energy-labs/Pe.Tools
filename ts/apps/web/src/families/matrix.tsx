import { PreviewAction } from "@pe/kit/lang/write-action";
import { refuse } from "#/route/refusal";
import { useRef, useState } from "react";
import { familyCellAddress } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import type { FamiliesDrawContext } from "./route";
import { TypeGrid } from "./pivot-grid";
import { useLiveCells } from "./matrix-columns";
import { useMeasuredParse } from "#/host/measured-parse";
export function FamiliesMatrix({ ctx }: { ctx: FamiliesDrawContext }) {
  const [failure, setFailure] = useState<string | null>(null);
  const run = async (id: string, input?: unknown) => {
    try {
      setFailure(null);
      await ctx.write(id).run(input);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  };
  const scroller = useRef<HTMLDivElement>(null);
  const data = ctx.value.value;
  const work = ctx.cells.doc;
  const shown = data?.observation;
  const rows = data?.rows ?? [];
  const params = data?.params ?? [];
  const pivot = { pivotRows: data?.pivotRows ?? [], pivotFamilies: data?.pivotFamilies ?? [] };
  const scope =
    ctx.target?.kind === "document"
      ? { bridgeSessionId: ctx.target.ref.session, openDocumentId: ctx.target.ref.openId }
      : undefined;
  const parse = useMeasuredParse(shown, scope);
  const filter = work?.scope.edit?.value ?? {
    categoryNames: [],
    familyNames: [],
    placementScope: "AllLoaded" as const,
  };
  const catalog = data?.catalog.families ?? [];
  const categories = data?.categories ?? [];
  const live = useLiveCells(work?.cells ?? {}, (key) => ctx.cells.at(["cells", key]));
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
              ctx.cells
                .at(["scope"])
                .stage(
                  { ...filter, categoryNames: [category], familyNames: [] },
                  { label: "Choose families" },
                )
            }
          >
            {category}
          </Button>
        ))}
        {catalog.map((family) => (
          <Button
            key={family.familyId}
            label={`Choose ${family.familyName}`}
            onClick={() =>
              ctx.cells.at(["scope"]).stage(
                {
                  ...filter,
                  categoryNames: [...filter.categoryNames],
                  familyNames: [family.familyName],
                },
                { label: "Choose families" },
              )
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
            void run("read", { readId });
          }}
        >
          Read families
        </Button>
        <Button label="Stop family read" onClick={() => run("stop")}>
          Stop
        </Button>
        <PreviewAction handle={ctx.write("apply")} label="Apply families" />
      </div>
      {!ctx.value.current && (
        <OutcomeLine kind="advisory" label="Family read" says={ctx.value.reason} />
      )}
      {shown?.progress && shown.progress.state !== "complete" && (
        <OutcomeLine
          kind={shown.progress.state === "failed" ? "error" : "advisory"}
          label="Family read"
          says={[
            shown.progress.phase,
            shown.progress.total ? `${shown.progress.completed}/${shown.progress.total}` : null,
            shown.progress.message,
          ]
            .filter(Boolean)
            .join(" - ")}
        />
      )}
      {(data?.outcomes ?? []).map((outcome) => (
        <OutcomeLine
          key={outcome.id}
          kind={outcome.kind}
          label="Family receipt"
          says={outcome.message}
        />
      ))}
      {failure && <OutcomeLine kind="error" label="Families" says={failure} />}
      <TypeGrid
        rows={pivot.pivotRows}
        types={rows}
        families={pivot.pivotFamilies}
        scroller={scroller}
        landed={landed}
        edit={{
          live,
          params: new Map(params.map((p) => [p.key, p])),
          readOnly: !ctx.cells.ready || !!data?.editRefusal,
          parse,
          propose: async (address, value, current) => {
            const result = await ctx.cells.edit(
              { address, value, current },
              {
                label: `${address.familyName} / ${address.typeName} / ${address.parameter} to ${value.value}`,
              },
            );
            return result ? refuse("not-ready", result.message) : null;
          },
        }}
      />
    </>
  );
}
