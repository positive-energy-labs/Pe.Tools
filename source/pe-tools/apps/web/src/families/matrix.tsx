import { EmptyState } from "#/components/lang/empty";
import { Verb } from "#/components/lang/verb";
import { MasterTable } from "#/components/master-table/master-table";
import { useFamiliesWorkspace } from "#/families/workspace-context";

export function FamiliesMatrix() {
  const {
    store,
    navigate,
    rows,
    columns,
    tableState,
    chips,
    totalFamilies,
    totalTypes,
    params,
    pickedIds,
    runProject,
    busy,
    connected,
    applied,
  } = useFamiliesWorkspace();
  return (
    <>
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
          <span className="flex items-center gap-2">
            <span title="Every family, type, and parameter the applied scope resolved to. Uncommon parameter columns may be hidden — the chip beside this says how many.">
              {totalFamilies} families · {totalTypes} types · {params.length} parameters
            </span>
            <Verb
              label="project → profile"
              onClick={() => runProject()}
              busy={busy === "project"}
              disabled={pickedIds.size === 0}
              reason={
                pickedIds.size === 0
                  ? "Nothing picked. Tick families in the pick column — projection runs the audit backwards, so it needs a source to read."
                  : `Run the audit backwards: read ${pickedIds.size} picked famil${pickedIds.size === 1 ? "y" : "ies"} out of the model as profile JSON, so an existing family can seed a profile instead of being reconciled against one. Read-only.`
              }
            />
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
              exit="pick categories in the scope row above, then press “apply scope”"
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
        /* Fleet → one family. The URL is the whole handoff: /family opens the requested
           family in the bound session's family editor and lands in its live lane. No
           cross-route store, nothing to keep in sync. */
        onRowClick={() => void navigate({ to: "/family", search: {} })}
      />
    </>
  );
}
