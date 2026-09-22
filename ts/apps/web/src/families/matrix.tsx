import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Table, type TableSelection } from "#/components/master-table/table";
import { TableFrame } from "#/components/master-table/table-frame";
import { useContext, useMemo } from "react";

import { nextPicks, pickedRowKeys } from "#/families/picks";
import { filterWords, standingFilterProposal } from "#/families/scope-band";
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
    picked,
    setPicked,
    connected,
    applied,
    workUnreadable,
    matrixReading,
    matrixIssue,
  } = useFamiliesWorkspace();
  // Chat's group drill-in: only the types holding a pending cell under the focused path.
  const scope = store.handle.work.doc?.scope;
  const proposed = scope ? standingFilterProposal(scope) : null;
  const focus = useContext(ChatFocus);
  const focused = focus && focusedTypes(store.cells, focus);
  const focusKeys = focused
    ? rows
        .filter((row) =>
          focused.some((at) => at.familyName === row.familyName && at.typeName === row.typeName),
        )
        .map((row) => row.key)
    : undefined;
  // A focus FILTERS, never empties (F-J1-4): when nothing pending sits under it, every family in
  // scope stays drawn and a line says the focus matched nothing.
  const focusMissed = focusKeys !== undefined && focusKeys.length === 0 && rows.length > 0;
  const visibleKeys = focusMissed ? undefined : focusKeys;
  const selectedKeys = useMemo(() => pickedRowKeys(rows, picked), [picked, rows]);
  // Picking a type picks its family: the selection is the pick set, drawn per row.
  const selection: TableSelection = {
    selected: selectedKeys,
    onChange: (keys) => setPicked(nextPicks(rows, picked, keys)),
  };
  return (
    <>
      {fixture && (
        <p className="px-4 py-1 t-small">
          Fixture review (no Revit capture).{" "}
          <a href="/families?demo=apply">plan confirmation fixture</a>
        </p>
      )}
      {focusMissed ? (
        <OutcomeLine
          kind="advisory"
          label={`nothing pending under ${focus!.join(" › ")}`}
          says="showing every family in scope"
        />
      ) : null}
      <TableFrame
        label="families in scope"
        rows={rows}
        columns={columns}
        rowKey={(row) => row.key}
        state={tableState}
        onStateChange={store.actions.setTable}
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
              {picked.size} picked
            </span>
          </span>
        }
        searchPlaceholder="family or type"
        chips={chips}
        selection={selection}
      >
        <Table
          rows={rows}
          columns={columns}
          rowKey={(row) => row.key}
          label="families in scope"
          state={tableState}
          onStateChange={store.actions.setTable}
          selection={selection}
          visibleKeys={visibleKeys}
          /* Opens a scratch copy of the family in Revit's family editor. That copy is not a pod
                     member, so there is nothing to address on /family until it is captured there. */
          onRowClick={(row) => {
            void store.actions.openFamily(row.familyId).catch(() => undefined);
          }}
          empty={
            // §4's two kinds of empty: the first three are the route's story (nothing in scope);
            // the last fires only when rows exist and the table's own narrowing hid them.
            workUnreadable ? (
              // The Situation's refusal sentence is the only instruction: this says what is, no exit.
              <p className="t-small text-ink-2">no matrix — the saved Work cannot be read</p>
            ) : !connected && store.handle.readings.inventory.state === "ready" ? (
              // The bridge answers; what is missing is the document (e2e finding 8).
              <EmptyState story="scope" exit="choose a document in the sentence above">
                nothing to audit — no document chosen
              </EmptyState>
            ) : !connected ? (
              <EmptyState
                story="scope"
                exit="connect the host in Revit, then bind that world in the sentence above"
              >
                nothing to audit — the bridge is disconnected
              </EmptyState>
            ) : applied === null ? (
              // The matrix reads the staged scope only; Pea's proposal waits for the person.
              proposed ? (
                <EmptyState
                  story="scope"
                  exit="accept it in the scope row above, or draft your own and press “apply scope”"
                >
                  Pea proposes {filterWords(proposed)}, accept or deny
                </EmptyState>
              ) : (
                <EmptyState
                  story="scope"
                  exit="pick categories in the scope row above, then press “apply scope” in the verb row"
                >
                  no scope staged — stage one; the matrix op is expensive, so it waits to be asked
                </EmptyState>
              )
            ) : matrixReading ? (
              <OutcomeLine kind="busy" label="reading the matrix" says="the applied scope" />
            ) : matrixIssue ? (
              <OutcomeLine kind="error" label="matrix unread" says={matrixIssue.message} />
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
        />
      </TableFrame>
    </>
  );
}
