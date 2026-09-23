import { useState } from "react";
import { showFamilyCell } from "@pe/agent-contracts";

import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { ActionButton } from "#/components/lang/action-button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "#/components/lang/dialog";
import { Press } from "#/components/lang/press";
import {
  fanOutWord,
  ReviewRow,
  runFanOut,
  UnstageAll,
  type FanOutOutcome,
} from "#/components/lang/band";
import { ValueDiff } from "#/components/lang/value-diff";
import type { Column } from "#/components/master-table/model";
import { Table } from "#/components/master-table/table";
import { familyCellEntries } from "#/families/staged";
import type { SalvagedExclusion } from "#/families/store";
import { filterWords } from "#/families/scope-band";
import { SectionLabel } from "#/families/readout-primitives";
import { useFamiliesWorkspace } from "#/families/workspace-context";
import { cn } from "#/lib/utils";

/** THE RECEIPTS: one bare `Table` row per family, as the op reported it. */
type Receipt = NonNullable<
  ReturnType<typeof useFamiliesWorkspace>["applyData"]
>["receipts"][number];
const CELL = "face-mono block truncate px-(--item-pad-x)";
const receiptColumns = (openPath: (path: string) => unknown): Column<Receipt>[] => [
  {
    key: "family",
    label: "family",
    width: "w-56",
    cell: (entry) => <span className={CELL}>{entry.familyName}</span>,
  },
  {
    key: "verdict",
    label: "verdict",
    width: "w-20",
    cell: (entry) => (
      <span className="flex px-(--item-pad-x)">
        <FactChip
          tone={entry.converged ? "done" : "alarm"}
          title={
            entry.success
              ? `The op reported this family written: ${entry.residue.length} change(s) remaining. This is the receipt, not the plan's promise.`
              : (entry.error ??
                "The op reported this family as failed and gave no reason. Re-plan and read the decision queue before retrying.")
          }
        >
          {entry.converged ? "converged" : entry.success ? "residue" : "failed"}
        </FactChip>
      </span>
    ),
  },
  {
    key: "residue",
    label: "residue",
    width: "w-40",
    title:
      "Changes still present after apply and recapture. Zero residue plus no errors means converged.",
    cell: (entry) => (
      <span className={cn(CELL, "text-ink-2")}>{entry.residue.length} remaining</span>
    ),
  },
  {
    key: "errors",
    label: "errors",
    cell: (entry) => (
      <span
        className={cn(CELL, "text-ink-2")}
        title={
          entry.errors.length > 0
            ? `Errors reported by this family: ${entry.errors.join(", ")}.`
            : (entry.error ?? "No errors reported.")
        }
      >
        {entry.errors.join(" · ") || (entry.error ?? "")}
      </span>
    ),
  },
  {
    key: "artifacts",
    label: "artifacts",
    width: "w-24",
    right: true,
    cell: (entry) =>
      entry.artifactDirectory && (
        /* Leaving the app entirely — nav:out, which is the direction browsers
           already taught. It writes nothing, so it is not blue-filled. */
        <ActionButton
          label="artifacts"
          tone="nav"
          direction="out"
          onClick={() => void openPath(entry.artifactDirectory ?? "")}
          reason={`Open the artifact bundle for this family in your OS file browser (${entry.artifactDirectory}). The bundle stays on disk — this route never copies it.`}
        />
      ),
  },
];

/** What the last apply actually did, per family, as the op reported it. */
export function FamiliesReceiptsBand() {
  const { store, applyData } = useFamiliesWorkspace();
  const [openError, setOpenError] = useState<string | null>(null);
  const openPath = async (path: string) => {
    setOpenError(null);
    try {
      await store.actions.openPath(path);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    }
  };
  if (!applyData) return null;
  const converged = applyData.receipts.filter((entry) => entry.converged).length;
  return (
    <Dialog>
      <DialogTrigger render={<Press tone="quiet" size="value" frame="line" />}>
        Apply results · {converged}/{applyData.receipts.length} converged
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Apply results</DialogTitle>
        {openError ? (
          <OutcomeLine kind="error" label="Couldn't open artifacts" says={openError} />
        ) : null}
        {applyData.diagnostics.map((issue) => (
          <OutcomeLine
            key={`${issue.code}:${issue.path}`}
            kind="error"
            label={issue.code}
            says={issue.message}
          />
        ))}
        <Table
          label="receipts"
          rows={applyData.receipts}
          columns={receiptColumns(openPath)}
          // A receipt is its family's, by name (ruling); the id it applied under is gone on reload.
          rowKey={(entry) => entry.familyName}
          empty={
            <EmptyState story="scope" exit="re-plan and read the decision queue before retrying">
              no receipts — apply ran and reported nothing
            </EmptyState>
          }
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * THE PROPOSALS BAND — every pending cell on the table, one `ReviewRow` each: the matrix cell's
 * own verbs (exactly `availableTransitions`, over the families wire), findable without scrolling
 * a large matrix. Its "all" verbs are aggregates only: one `runFanOut` each (an aggregate accept
 * skips contested cells, A7), with the outcome in the kit's words. Plan reads staged cells.
 */
export function FamiliesProposalsBand() {
  const { cells, rows, params, wire, plan } = useFamiliesWorkspace();
  const [outcome, setOutcome] = useState<FanOutOutcome | null>(null);
  // A plan row with no resolved id (no `hashKey`) is a name the host refused, in its own words.
  const orphans = new Map(
    (plan?.entries ?? []).flatMap((entry) =>
      entry.hashKey === undefined && entry.flag ? [[entry.id, entry.flag] as const] : [],
    ),
  );
  const entries = familyCellEntries(cells).filter(
    (entry) => entry.cell.proposal != null || entry.cell.staged != null,
  );
  const current = (entry: (typeof entries)[number]) => {
    const key = params.find((param) => param.name === entry.parameter)?.key;
    const row = rows.find(
      (r) => r.familyName === entry.familyName && r.typeName === entry.typeName,
    );
    return key && row ? (row.values[key] ?? "") : null;
  };
  const keys = entries.map((entry) => entry.key);
  const open = entries.filter(({ cell }) => cell.proposal != null && cell.staged == null);
  const staged = entries.filter(({ cell }) => cell.staged != null);
  const all = (kind: "accept" | "deny") => void runFanOut(wire, cells, keys, kind).then(setOutcome);
  if (!entries.length && !outcome?.refusal) return null;
  return (
    <section aria-label="proposals" className="flex flex-col gap-1 py-1">
      <Dialog>
        <DialogTrigger render={<Press tone="quiet" size="value" frame="line" />}>
          Review edits · {open.length} open · {staged.length} staged
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Review family edits</DialogTitle>
          <div className="flex items-center gap-2">
            <SectionLabel>
              <span title="Pea proposes; you stage reviewed values. Plan reads staged cells.">
                proposals
              </span>
            </SectionLabel>
            <FactChip tone={open.length ? "pea" : "meta"} title="Proposals nobody has staged yet.">
              {open.length} open
            </FactChip>
            <FactChip
              tone={staged.length ? "caution" : "meta"}
              title="Staged cells: what plan will generate."
            >
              {staged.length} staged
            </FactChip>
            <span className="ml-auto flex items-center gap-1">
              <ActionButton
                tone="agent"
                label="accept all"
                disabled={!open.length}
                reason={
                  open.length
                    ? `Accept every open proposal in one write; cells you staged yourself are skipped. Nothing reaches Revit until apply.`
                    : "nothing is open to accept"
                }
                onClick={() => all("accept")}
              />
              <ActionButton
                label="deny all"
                reason="Clear every proposal on this table in one write. Staged values stay."
                onClick={() => all("deny")}
              />
              <UnstageAll wire={wire} cells={cells} keys={keys} done={setOutcome} />
            </span>
          </div>
          <div data-slot="proposals-list" className="flex flex-col gap-1">
            {outcome ? (
              <OutcomeLine
                kind={outcome.refusal ? "refused" : "receipt"}
                label={fanOutWord(outcome)}
                says={outcome.refusal ? "nothing was written" : undefined}
              />
            ) : null}
            {entries.length === 0 ? (
              <span className="t-small text-ink-2">nothing proposed or staged</span>
            ) : null}
            {entries.map((entry) => (
              <div key={entry.key}>
                <ReviewRow
                  wire={wire}
                  address={entry.key}
                  label={
                    <span className="face-mono text-ink-2" data-proposal-row={entry.key}>
                      {entry.familyName} · {entry.typeName} · {entry.parameter}
                    </span>
                  }
                  cell={entry.cell}
                  facts={{
                    value: (
                      <ValueDiff
                        from={current(entry)}
                        to={showFamilyCell(
                          (entry.cell.staged ?? entry.cell.proposal)?.value ?? { value: "" },
                        )}
                      />
                    ),
                  }}
                  show={showFamilyCell}
                />
                {/* Orphaned: the plan could not resolve this family by name. Clearing stays free. */}
                {orphans.has(entry.familyName) ? (
                  <OutcomeLine
                    kind="refused"
                    label="orphaned"
                    says={orphans.get(entry.familyName)}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** One salvaged exclusion as the person reads it: its current name, or that it is gone. */
const heldWord = (row: SalvagedExclusion) => row.name ?? `element ${row.id} · no longer loaded`;

/**
 * In the start-fresh confirm, read-only: what the Work being set aside held back, by the names the
 * catalog gives those families now. Nothing carries over from here.
 */
export function SalvagedExclusions() {
  const { store } = useFamiliesWorkspace();
  const { data, error, pending } = store.salvaged;
  if (pending) return <OutcomeLine kind="busy" label="reading what it held back" />;
  if (error) return <OutcomeLine kind="error" label="old exclusions unread" says={error.message} />;
  if (!data?.rows.length && !data?.scope)
    return <span className="t-small text-ink-2">it held no families back</span>;
  return (
    <div className="flex flex-col gap-0.5 t-small" aria-label="held back in the old Work">
      <span className="text-ink-2">held back in the old Work (read-only; set aside with it):</span>
      {data.scope ? <span className="face-mono">scoped {filterWords(data.scope)}</span> : null}
      {data.rows.map((row) => (
        <span key={row.name ?? row.id} className="face-mono">
          {heldWord(row)}
        </span>
      ))}
    </div>
  );
}

/**
 * On the fresh page after start fresh: one line offers the old scope and exclusions back, until
 * pressed, dismissed, or the next plan. One press stages the scope and re-excludes as the person;
 * ids the catalog no longer resolves are said, never written.
 */
export function FamiliesCarryOverLine() {
  const { store } = useFamiliesWorkspace();
  const salvaged = store.salvaged.data;
  if (!store.page.carryOver || !salvaged || (!salvaged.rows.length && !salvaged.scope)) return null;
  const { rows, scope } = salvaged;
  const resolved = rows.filter((row) => row.name !== null).length;
  const said = [
    rows.length ? `held back ${rows.map(heldWord).join(", ")}` : null,
    scope ? `scoped ${filterWords(scope)}` : null,
  ];
  return (
    <div className="flex flex-wrap items-baseline gap-2 px-4 py-1 t-small" role="status">
      <span>the old Work {said.filter(Boolean).join("; ")}</span>
      {resolved || scope ? (
        <ActionButton
          label="restore these"
          reason={[
            scope ? "Stage the old scope again" : null,
            resolved
              ? `hold ${resolved} famil${resolved === 1 ? "y" : "ies"} back from plan again, as yours`
              : null,
          ]
            .filter(Boolean)
            .join(", and ")
            .concat(", in one write")}
          onClick={() => void store.actions.restore(salvaged)}
        />
      ) : null}
      <ActionButton
        label="dismiss"
        reason="Keep the fresh Work as it is; the old one stays set aside"
        onClick={store.actions.dismissCarryOver}
      />
    </div>
  );
}
