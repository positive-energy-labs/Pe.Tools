import { EmptyState } from "#/components/lang/empty";
import { MasterTable } from "#/components/master-table/master-table";
import { useContext, useMemo } from "react";

import { focusedTypes } from "#/families/staged";
import { useFamiliesWorkspace } from "#/families/workspace-context";
import { ChatFocus } from "#/route/situation";

export function FamiliesMatrix() {
  const {
    store,
    fixture,
    rows,
    columns,
    tableState,
    chips,
    totalFamilies,
    totalTypes,
    params,
    pickedIds,
    setPickedIds,
    connected,
    applied,
  } = useFamiliesWorkspace();
  // Chat's group drill-in: only the types holding a pending cell under the focused path.
  const focus = useContext(ChatFocus);
  const focused = focus && focusedTypes(store.cells, focus);
  const visibleKeys = focused
    ? rows
        .filter((row) =>
          focused.some((at) => at.familyId === row.familyId && at.typeName === row.typeName),
        )
        .map((row) => row.key)
    : undefined;
  const selectedKeys = useMemo(
    () => new Set(rows.filter((row) => pickedIds.has(row.familyId)).map((row) => row.key)),
    [pickedIds, rows],
  );
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
        visibleKeys={visibleKeys}
        scopeLabel="families in scope"
        searchPlaceholder="family or type"
        tableState={tableState}
        onTableStateChange={store.actions.setTable}
        selectedKeys={selectedKeys}
        onSelectedKeysChange={(keys) => {
          const next = new Set(pickedIds);
          const changedFamilies = new Set(
            rows
              .filter((row) => keys.has(row.key) !== selectedKeys.has(row.key))
              .map((row) => row.familyId),
          );
          for (const familyId of changedFamilies) {
            if (
              rows.some(
                (row) =>
                  row.familyId === familyId &&
                  keys.has(row.key) !== selectedKeys.has(row.key) &&
                  keys.has(row.key),
              )
            )
              next.add(familyId);
            else next.delete(familyId);
          }
          setPickedIds(next);
        }}
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
        /* Opens a scratch copy of the family in Revit's family editor. That copy is not a pod
           member, so there is nothing to address on /family until it is captured there. */
        onRowClick={(row) => {
          void store.actions.openFamily(row.familyId).catch(() => undefined);
        }}
      />
    </>
  );
}
