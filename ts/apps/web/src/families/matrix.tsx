import { FactChip } from "@pe/kit/lang/chip";
import { EmptyState } from "@pe/kit/lang/empty";
import { routeAddress, type FamiliesReadProgress } from "@pe/agent-contracts";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { FamiliesPivot } from "#/families/pivot";
import { filterWords, standingFilterProposal } from "#/families/scope-band";
import { useFamiliesWorkspace } from "#/families/workspace-context";

function FamiliesReadStatus({ progress }: { progress: FamiliesReadProgress }) {
  return (
    <OutcomeLine
      kind={
        progress.state === "reading" ? "busy" : progress.state === "failed" ? "error" : "advisory"
      }
      label={`${progress.completed} of ${progress.total || "…"} families · ${progress.phase}`}
      says={
        progress.message ??
        (progress.state === "reading"
          ? `${progress.workers} worker${progress.workers === 1 ? "" : "s"}`
          : progress.state === "cancelled"
            ? "read stopped; completed families retained"
            : progress.state)
      }
    />
  );
}

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
    readProgress,
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
      <EmptyState story="filter" exit="clear a query chip">
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
  ) : readProgress && readProgress.state !== "complete" ? (
    <OutcomeLine
      kind="advisory"
      label="no completed families"
      says="read the scope again to finish"
    />
  ) : rows.length === 0 ? (
    <EmptyState story="scope" exit="change the target picker and press “read families” again">
      the applied scope resolved to no families
    </EmptyState>
  ) : (
    <EmptyState story="filter" exit="clear a query chip">
      the narrowing hid all {totalTypes} types in scope
    </EmptyState>
  );
  return (
    <FamiliesPivot
      empty={empty}
      above={
        <>
          {readProgress && readProgress.state !== "complete" && (
            <div className="px-4 py-1">
              <FamiliesReadStatus progress={readProgress} />
            </div>
          )}
          {/* I6: a mark plus a word, not a sentence; the why is the chip's hint. */}
          {fixture && (
            <p className="flex items-center gap-2 px-4 py-1 t-small">
              <FactChip dashed title="Fixture review: no Revit capture behind these values">
                fixture
              </FactChip>
              <a href={routeAddress("families").link({ demo: "apply" })}>plan fixture</a>
            </p>
          )}
        </>
      }
    />
  );
}
