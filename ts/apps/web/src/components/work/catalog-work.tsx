/**
 * The shared review for a Page-less catalog owner (ADR 0030 rule 2): its staged cells with their authors, and
 * the one write button over the generated plan/apply pair. A person on /ducts sees the same Work, handle and
 * sealed plan Pea plans through; no per-op component and no Page. The before value is the model's, which
 * this Work does not read, so it says "unknown" rather than guessing.
 */
import { useCallback, useEffect, useState } from "react";
import {
  catalogWorkCommands,
  catalogWorks,
  editableCells,
  writeResponseSchema,
  type ActionAdmission,
  type ActionReceipt,
  type DocumentRef,
  type WorkHandle,
  type WorkKey,
  type WorkPath,
} from "@pe/agent-contracts";
import { WriteAction, writeWord, type WriteCell, type WriteRun } from "@pe/kit/lang/write-action";

type Owner = keyof typeof catalogWorks;
// ponytail: the cell universe until `catalogWorkSpecs[owner].editable` lands (edge sent to the contracts
// line); then read it from the spec and delete this map.
const EDITABLE: Record<Owner, WorkPath[]> = {
  "data-tables": [["name"], ["columns", "*"], ["rows", "*", "*"]],
  "parameter-links": [["definitions", "*"], ["assignments", "*"]],
};

export interface CatalogWorkClient {
  read(key: WorkKey): Promise<{ doc: unknown; handle: WorkHandle } | null>;
  submit(admission: ActionAdmission): Promise<ActionReceipt>;
}

/** Staged cells as the write popover draws them: path, staged value, author; before is unknown here. */
export function catalogWorkCells(owner: Owner, doc: unknown): WriteCell[] {
  return editableCells(doc, EDITABLE[owner])
    .filter(({ cell }) => cell.edit != null)
    .map(({ path, cell }) => {
      const edit = cell.edit as { value?: unknown; delete?: true; by?: WriteCell["author"] };
      return {
        key: path.join("/"),
        label: path.join(" · "),
        before: null,
        after: edit.delete ? "(delete)" : typeof edit.value === "string" ? edit.value : JSON.stringify(edit.value ?? null),
        author: edit.by ?? "unknown",
      };
    });
}

const applyKeyOf = (owner: Owner) =>
  Object.entries(catalogWorkCommands).find(
    ([, entry]) => entry.work.route === owner && entry.writeBoundary.phase === "apply",
  )![0];
const refusalOf = (row: ActionReceipt) =>
  row.state === "succeeded"
    ? null
    : { message: (row as { refusal?: { message?: string } }).refusal?.message ?? `Plan ${row.state}` };

export function CatalogWorkReview({
  owner,
  at,
  target,
  client,
}: {
  owner: Owner;
  /** The owner's Work key at this document (the route's key with `route: owner`). */
  at: WorkKey;
  target: DocumentRef;
  client: CatalogWorkClient;
}) {
  const key = applyKeyOf(owner);
  const [work, setWork] = useState<{ doc: unknown; handle: WorkHandle } | null>(null);
  const [plan, setPlan] = useState<{ revision: number; cells: WriteCell[] } | null>(null);
  const reload = useCallback(async () => setWork(await client.read(at)), [client, at]);
  useEffect(() => void reload(), [reload]);
  const cells = work ? catalogWorkCells(owner, work.doc) : [];
  // The plan holds only while the Work it sealed is current; any later revision disarms it.
  const held = plan && work && plan.revision === work.handle.revision ? plan : null;
  const admit = (id: string, k: string) =>
    client.submit({ id: `${id}-${crypto.randomUUID()}`, key: k, target: { kind: "document", ref: target }, input: { work: work!.handle } });
  const runPlan = async (): WriteRun => {
    const row = await admit("plan", `${key}.preview`);
    const refused = refusalOf(row);
    if (!refused && writeResponseSchema.safeParse((row as { result?: unknown }).result).success)
      setPlan({ revision: work!.handle.revision, cells });
    return refused;
  };
  const runApply = async (): WriteRun => {
    const refused = refusalOf(await admit("apply", key));
    await reload();
    return refused;
  };
  return (
    <section data-catalog-work={owner} className="flex flex-col gap-1.5">
      <div className="t-small t-upper text-ink-mute">
        {owner} · {work ? `r${work.handle.revision}` : "unread"} · {cells.length} staged
      </div>
      {cells.map((cell) => (
        <div key={cell.key} data-catalog-cell={cell.key} className="t-small">
          {cell.label} = {cell.after} · <span data-catalog-author={cell.author}>{cell.author}</span>
        </div>
      ))}
      <WriteAction
        label={`plan ${owner}`}
        says={`Plan ${owner} from the current Work`}
        refusal={!work ? "Read the Work first" : cells.length ? null : "Nothing staged"}
        held={held ? { word: writeWord(owner, held.cells.length, false), summary: `${held.cells.length} staged`, cells: held.cells } : null}
        stale={plan && !held ? "changed since plan" : null}
        plan={runPlan}
        apply={{
          label: `apply ${owner}`,
          says: `Apply what the plan sealed to ${owner}`,
          refusal: held ? null : "Plan the current Work first",
          run: runApply,
          done: `${owner} sent`,
        }}
      />
    </section>
  );
}
