import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { FamiliesPivot } from "#/families/pivot";
import { filterWords, standingFilterProposal } from "#/families/scope-band";
import { useFamiliesWorkspace } from "#/families/workspace-context";

export function FamiliesMatrix() {
  const {
    store,
    archived,
    fixture,
    rows,
    totalTypes,
    connected,
    applied,
    workUnreadable,
    matrixReading,
    matrixIssue,
  } = useFamiliesWorkspace();
  const scope = archived ? null : store.handle.work.doc?.scope;
  const proposed = scope ? standingFilterProposal(scope) : null;
  const empty = archived ? (
    matrixReading ? (
      <OutcomeLine kind="busy" label="loading archived reading" says="saved on this host" />
    ) : matrixIssue ? (
      <OutcomeLine kind="error" label="archived reading unavailable" says={matrixIssue.message} />
    ) : !store.archive.selectedId ? (
      <EmptyState story="scope" exit="read families in Audit to save an observation">
        no archived family readings yet
      </EmptyState>
    ) : rows.length === 0 ? (
      <EmptyState story="scope" exit="choose another past read above">
        this archived read contains no families
      </EmptyState>
    ) : (
      <EmptyState story="filter" exit="clear a rule or column filter">
        the narrowing hid all {totalTypes} types in this read
      </EmptyState>
    )
  ) : workUnreadable ? (
    <p className="t-small text-ink-2">no matrix — the saved Work cannot be read</p>
  ) : !connected && store.handle.readings.inventory.state === "ready" ? (
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
    proposed ? (
      <EmptyState
        story="scope"
        exit="accept it, or choose families in the target picker and press “read families”"
      >
        Pea proposes {filterWords(proposed)}, accept or deny
      </EmptyState>
    ) : (
      <EmptyState
        story="scope"
        exit="choose a scope in the target picker, then press “read families”"
      >
        no families read — the matrix waits for “read families”
      </EmptyState>
    )
  ) : matrixReading ? (
    <OutcomeLine kind="busy" label="reading the matrix" says="the applied scope" />
  ) : matrixIssue ? (
    <OutcomeLine kind="error" label="matrix unread" says={matrixIssue.message} />
  ) : rows.length === 0 ? (
    <EmptyState story="scope" exit="change the target picker and press “read families” again">
      the applied scope resolved to no families
    </EmptyState>
  ) : (
    <EmptyState story="filter" exit="clear a rule or column filter">
      the narrowing hid all {totalTypes} types in scope
    </EmptyState>
  );
  return (
    <FamiliesPivot
      empty={empty}
      above={
        <>
          {fixture && (
            <p className="px-4 py-1 t-small">
              Fixture review (no Revit capture).{" "}
              <a href="/families?demo=apply">plan confirmation fixture</a>
            </p>
          )}
          {applied && !archived && (
            <p className="px-4 py-1 t-small text-ink-2">last read · {filterWords(applied)}</p>
          )}
        </>
      }
    />
  );
}
