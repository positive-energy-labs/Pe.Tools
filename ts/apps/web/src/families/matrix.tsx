import { PreviewAction } from "@pe/kit/lang/write-action";
import { refuse } from "#/route/refusal";
import { useMemo, useRef, useState } from "react";
import { familyCellAddress } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { ButtonGroup } from "@pe/kit/lang/button-group";
import { List } from "@pe/kit/lang/list-popup";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import type { FamiliesDrawContext } from "./route";
import { TypeGrid } from "./pivot-grid";
import { useCellCollection } from "@pe/kit/lang/cell";
import { useMeasuredParse } from "#/host/measured-parse";
import { FindingVerb } from "#/route/slots/findings/verb";
import { joinRows } from "./families-matrix";
import { subjectCode } from "../../../../packages/agent-contracts/src/subject-ref.ts";
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
  const rows = useMemo(() => (data ? joinRows(data.rows, data.facts) : []), [data]);
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
  const scopeCell = ctx.cells.at(["scope"]);
  const catalog = data?.catalog.families ?? [];
  const categories = data?.categories ?? [];
  const choices = [
    ...categories.map((name) => ({ key: `c:${name}`, name, group: "Categories" as const })),
    ...catalog.map((family) => ({
      key: `f:${family.familyId}`,
      name: family.familyName,
      group: "Families" as const,
    })),
  ];
  const live = useCellCollection(work?.cells ?? {}, (key) => ctx.cells.at(["cells", key]));
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
      <div role="group" aria-label="Family scope" className="flex flex-col">
        {scopeCell.refusal && (
          <OutcomeLine kind="refused" label="Family scope unavailable" says={scopeCell.refusal} />
        )}
        {/* One kit list, one row anatomy (P1, N3): categories then families, searchable. */}
        <List
          aria-label="Family scope choices"
          items={choices}
          keyOf={(choice) => choice.key}
          labelOf={(choice) => choice.name}
          groupOf={(choice) => choice.group}
          leadingGroups={["Categories", "Families"]}
          // ponytail: 6 rows per group is a first guess (M1); "N more" and search reach the rest.
          groupCap={6}
          filter="substring"
          searchPlaceholder="search categories and families…"
          empty="no categories or families read yet"
          onPick={(choice) =>
            scopeCell.stage(
              choice.group === "Categories"
                ? { ...filter, categoryNames: [choice.name], familyNames: [] }
                : {
                    ...filter,
                    categoryNames: [...filter.categoryNames],
                    familyNames: [choice.name],
                  },
              { label: "Choose families" },
            )
          }
          row={(choice) => ({ label: choice.name, refusal: scopeCell.refusal })}
        />
      </div>
      {/* One verb shape (P1): the plain action button is framed (ledger 2026-10-12), like the plan
          press beside it; bare words beside a box read as two kinds of thing. */}
      <ButtonGroup label="Family verbs">
        <Button
          kind="framed"
          label="Read families"
          onClick={() => {
            const readId = crypto.randomUUID();
            ctx.page.pose({ readId }, "named");
            void run("read", { readId });
          }}
        >
          Read families
        </Button>
        <Button kind="framed" label="Stop family read" onClick={() => run("stop")}>
          Stop
        </Button>
        <PreviewAction handle={ctx.write("apply")} label="Apply families" />
      </ButtonGroup>
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
        typeVerb={(type) => (
          <FindingVerb
            subject={subjectCode({ keyKind: "name", key: [type.familyName, type.typeName] })}
            name={`${type.familyName} · ${type.typeName}`}
            write={(finding) => ctx.write("finding").run(finding)}
          />
        )}
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
