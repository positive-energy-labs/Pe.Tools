import { EmptyState } from "#/components/lang/empty";
import { MasterTable } from "#/components/master-table/master-table";
import { useFamiliesWorkspace } from "#/families/workspace-context";

export function FamiliesMatrix() {
  const {
    store,
    fixture,
    navigate,
    rows,
    columns,
    tableState,
    chips,
    totalFamilies,
    totalTypes,
    params,
    pickedIds,
    connected,
    applied,
  } = useFamiliesWorkspace();
  return (
    <>
      {fixture && (
        <p className="px-4 py-1 t-small">
          Fixture review (no Revit capture).{" "}
          <a href="/families?demo=apply">plan confirmation fixture</a>
        </p>
      )}
      <MasterTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.key}
        scopeLabel="families in scope"
        searchPlaceholder="family or type"
        tableState={tableState}
        onTableStateChange={store.actions.setTable}
        chips={chips}
        summary={
          <span className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 face-mono">
            <span className="text-ink" title="Every family and type the applied scope resolved to.">
              {totalFamilies} families · {totalTypes} types
            </span>
            <span
              className="text-ink-2"
              title="Every parameter the applied scope resolved to. Uncommon columns may be hidden by the chip beside this."
            >
              {params.length} parameters
            </span>
            <span
              className="hairline-l pl-2 text-ink-2"
              title="Picked families are what capture files into the pod, one spec member each."
            >
              {pickedIds.size} picked
            </span>
          </span>
        }
        empty={
          // §4's two kinds of empty: the first three are the route's story (nothing in scope);
          // the last fires only when rows exist and the table's own narrowing hid them.
          !connected ? (
            <EmptyState
              story="scope"
              exit="connect the host in Revit, then bind that world in the sentence above"
            >
              nothing to audit — the bridge is disconnected
            </EmptyState>
          ) : applied === null ? (
            <EmptyState
              story="scope"
              exit="pick categories in the scope row above, then press “apply scope” in the verb row"
            >
              no scope applied yet — the matrix op is expensive, so it waits to be asked
            </EmptyState>
          ) : rows.length === 0 ? (
            <EmptyState
              story="scope"
              exit="add a category, re-add families in the families picker, or relax the placement filter, then re-apply the scope"
            >
              the applied scope resolved to no families
            </EmptyState>
          ) : (
            <EmptyState story="filter" exit="clear a column filter or the search">
              the narrowing hid all {totalTypes} types in scope
            </EmptyState>
          )
        }
        /* The existing editor operation activates a scratch family copy; capture that returned document. */
        onRowClick={(row) => {
          void store.actions
            .openFamily(row.familyId)
            .then((opened) => {
              const path = (opened as { savedPath?: string | null }).savedPath;
              if (path) void navigate({ to: "/family", search: { file: path } });
            })
            .catch(() => undefined);
        }}
      />
    </>
  );
}
