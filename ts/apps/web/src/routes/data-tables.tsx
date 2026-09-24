import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { actionAdmissionSchema } from "@pe/agent-contracts";
import { EmptyState } from "#/components/lang/empty";
import { Pane } from "#/components/lang/pane";
import { Surface } from "#/components/lang/surface";
import { useHostOp } from "#/readings";
import { RouteShell, defineRoute, refuse, useRoute, useRouteThread, type Ctx } from "#/route";
import { Ladder, type Rung } from "#/route/ladder";
import { routeSearch } from "#/route/route-owner";
import { useChooseTarget } from "#/route/shell";
import { Situation } from "#/route/situation";
import { useDocumentLadder } from "#/route/situation-ladder";
import { NATIVE_APPLY_WAIT_S } from "#/route/waits";
import { DraftEditor } from "#/data-tables/draft-editor";
import { submitAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";

/**
 * /data-tables — author synthetic data tables in the document the sentence names. The table is
 * the ladder's last rung (revit.detail.data-tables, read from that document); the editor drafts
 * name, columns and rows; `apply` admits one `data-table.apply` against that exact document.
 * Missing rows are pruned on apply, so deleting a row here deletes it in Revit.
 */
export const dataTablesSearch = routeSearch;

export const Route = createFileRoute("/data-tables")({
  validateSearch: dataTablesSearch,
  component: DataTablesRoute,
});

export type ColumnKind = "Text" | "Number";

export interface Draft {
  name: string;
  isNew: boolean;
  columns: { heading: string; kind: ColumnKind }[];
  rows: { key: string; values: (string | null)[] }[];
}

interface TableHandle {
  name: string;
  columns: { heading: string; kind: ColumnKind }[];
  rows: { key: string; values: (string | null)[] }[];
  placements: { sheetNumber: string }[];
}

export const rowKey = () => `row-${crypto.randomUUID().slice(0, 8)}`;

const draftFrom = (table: TableHandle): Draft => ({
  name: table.name,
  isNew: false,
  columns: table.columns.map((column) => ({ ...column })),
  rows: table.rows.map((row) => ({ key: row.key, values: [...row.values] })),
});

const blank = (): Draft => ({
  name: "New Table",
  isNew: true,
  columns: [{ heading: "Column 1", kind: "Text" }],
  rows: [{ key: rowKey(), values: [null] }],
});

type DataTablesCtx = Ctx<never, never, Record<string, never>>;

/** The route's two verbs over the open draft; `apply` is admitted against the resolved document. */
const dataTablesManifest = (draft: Draft | null, setDraft: (next: Draft | null) => void) =>
  defineRoute<never, never, Record<string, never>, "new" | "apply">({
    key: "data-tables",
    name: "Data Tables",
    needs: "project",
    docs: "Choose a document and a data table (or start a new one), edit its columns and rows, then apply. Apply upserts by table name and row key, and prunes rows the draft no longer carries: deleting a row here deletes it in Revit.",
    actions: {
      new: {
        label: "new table",
        says: "Starts a blank draft; nothing exists in Revit until apply",
        needs: "project",
        actor: "any",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: [],
        ready: () => null,
        run: async () => setDraft(blank()),
      },
      apply: {
        label: "apply",
        labelNow: () => (draft?.name.trim() ? `apply ${draft.name.trim()}` : "apply"),
        does: () => ({
          says: "Upserts the draft into the sentence's document by table name and row key; rows the draft no longer carries are pruned",
          needs: "project-document",
          actor: "human",
        }),
        input: z.void() as unknown as z.ZodType<never>,
        dirties: [],
        chord: "Mod+Enter",
        waitSeconds: NATIVE_APPLY_WAIT_S,
        ready: () =>
          !draft
            ? "choose a table or start a new one first"
            : draft.name.trim().length === 0
              ? "name the table first; apply upserts by name"
              : null,
        run: async (ctx: DataTablesCtx) => {
          if (!draft) throw Error("choose a table or start a new one first");
          if (ctx.target.kind !== "document") throw Error("choose a document");
          const action = await submitAction(
            actionAdmissionSchema.parse({
              id: crypto.randomUUID(),
              kind: "operation",
              key: "data-table.apply",
              actor: "human",
              destination: ctx.target,
              input: {
                table: {
                  name: draft.name,
                  columns: draft.columns,
                  rows: draft.rows,
                  pruneMissingRows: true,
                },
              },
              bases: {},
            }),
            "",
            NATIVE_APPLY_WAIT_S * 1000,
          );
          if (action.state !== "succeeded")
            throw Error(
              "error" in action && action.error ? String(action.error) : `apply ${action.state}`,
            );
          setDraft({ ...draft, isNew: false });
          const warnings =
            (action as unknown as { result?: { warnings?: string[] } }).result?.warnings ?? [];
          return warnings.length ? refuse("partial", warnings.join(" · ")) : null;
        },
      },
    },
  });

function DataTablesRoute() {
  const [chosen] = useChooseTarget();
  const thread = useRouteThread();
  const [draft, setDraft] = useState<Draft | null>(null);
  const manifest = useMemo(() => dataTablesManifest(draft, setDraft), [draft]);
  const handle = useRoute(manifest, { target: chosen, thread });
  const ladder = useDocumentLadder(handle);
  const doc =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  const docKey = doc ? `${doc.session}:${doc.openId}` : null;
  // The table list is read from the one document the sentence names, never the active one.
  const detail = useHostOp(
    "revit.detail.data-tables",
    {},
    { bridgeSessionId: doc?.session, openDocumentId: doc?.openId, enabled: doc !== null },
  );
  const tables = (detail.data?.tables ?? []) as TableHandle[];
  // A draft belongs to the document it was opened on.
  useEffect(() => setDraft(null), [docKey]);
  // An apply changes the list; it re-reads once the verb lands.
  const outcome = handle.outcome;
  useEffect(() => {
    if (outcome?.key === "apply") detail.refresh();
  }, [outcome]); // eslint-disable-line react-hooks/exhaustive-deps

  // The Situation palette is the sentence's ladder; opening it re-lists the tables.
  const [palette, setPalette] = useState(false);
  const openPalette = (open: boolean) => {
    setPalette(open && handle.busy === null);
    if (open && doc) detail.refresh();
  };
  const tableRung: Rung = {
    key: "table",
    label: draft ? draft.name || "untitled" : null,
    placeholder: "choose a table",
    options: detail.data
      ? tables.map((table) => ({
          id: table.name,
          label: table.name,
          sub: [
            `${table.columns.length}×${table.rows.length}`,
            table.placements.length
              ? `on ${table.placements.map((p) => p.sheetNumber).join(", ")}`
              : null,
          ]
            .filter(Boolean)
            .join(" · "),
        }))
      : null,
    note: detail.data
      ? "no data tables in this document; start one with new table"
      : (detail.error?.message ?? (doc ? "reading data tables…" : "choose a document first")),
    picked: (id) => draft !== null && !draft.isNew && draft.name === id,
    pick: (id) => {
      const table = tables.find((row) => row.name === id);
      if (table) setDraft(draftFrom(table));
    },
  };

  return (
    <Surface
      head={
        <RouteShell
          manifest={manifest}
          handle={handle}
          situation={
            <Situation
              handle={handle}
              target={{ session: ladder.sessionWord, document: ladder.docWord }}
              commit="apply"
              palette={() => openPalette(true)}
              sentence={
                <>
                  data table in{" "}
                  <Ladder
                    levels={[...ladder.levels, tableRung]}
                    disabled={handle.busy !== null}
                    caution={ladder.lost}
                    open={palette}
                    onOpenChange={openPalette}
                  />
                  {ladder.refusal ? (
                    <span role="status" data-tone="caution">
                      {" "}
                      ({ladder.refusal})
                    </span>
                  ) : null}
                  .
                </>
              }
            />
          }
        />
      }
    >
      <Pane
        kind="content"
        title={draft?.name ?? "table"}
        meta={draft ? `${draft.columns.length}×${draft.rows.length}` : undefined}
        scroll="clip"
        flush
      >
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {draft ? (
            <DraftEditor draft={draft} setDraft={setDraft} />
          ) : (
            <div className="grid h-full place-items-center">
              <EmptyState story="scope" exit="choose a table in the sentence, or start a new table">
                no table open
              </EmptyState>
            </div>
          )}
        </div>
      </Pane>
    </Surface>
  );
}
