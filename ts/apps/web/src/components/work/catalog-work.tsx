/**
 * The shared review for a Page-less catalog owner (ADR 0030 rule 2): its staged cells with their authors, and
 * the one write button over the generated plan/apply pair. A person on /ducts sees the same Work, handle and
 * sealed plan Pea plans through; no per-op component and no Page. A held plan draws its cells from the plan
 * response itself (`evidence.touched`: the model's before it read, the after, the author), so an absent
 * before says "(none)". Every owner reads its stored base at plan (K3), so a plan that discloses no touched
 * cell arms nothing.
 */
import { useEffect, useState, type ComponentProps } from "react";
import {
  catalogWorkCommands,
  catalogWorks,
  catalogWorkSpecs,
  cellPatches,
  editableCells,
  writeResponseSchema,
  type ActionAdmission,
  type ActionReceipt,
  type CatalogTouch,
  type DocumentRef,
  type WorkHandle,
  type WorkKey,
  type RouteStatePatch,
  type WriteSeal,
} from "@pe/agent-contracts";
import { WriteAction, writeWord, type WriteCell, type WriteRun } from "@pe/kit/lang/write-action";
import { StateCell, cellFromDraft } from "@pe/kit/lang/cell";

type Owner = keyof typeof catalogWorks;
export interface CatalogWorkClient {
  watch(
    key: WorkKey,
    receive: (work: { doc: unknown; handle: WorkHandle }) => void,
    fail: (reason: string) => void,
  ): () => void;
  write(
    handle: WorkHandle,
    patches: RouteStatePatch[],
    label: string,
  ): Promise<{ code: string; message: string } | null>;
  submit(admission: ActionAdmission): Promise<ActionReceipt>;
}

/** Staged cells as the write popover draws them: path, staged value, author; before is unknown here. */
export function catalogWorkCells(owner: Owner, doc: unknown) {
  return editableCells(doc, catalogWorkSpecs[owner].editable)
    .filter(({ cell }) => cell.edit != null)
    .map(({ path: storedPath, cell }) => {
      const path = storedPath.map((key) => {
        if (typeof key !== "string") throw Error("Catalog Work cells must have authored keys");
        return key;
      });
      const edit = cell.edit as { value?: unknown; delete?: true; by?: WriteCell["author"] };
      return {
        key: path.join("/"),
        label: path.join(" · "),
        before: null,
        after: edit.delete
          ? "(delete)"
          : typeof edit.value === "string"
            ? edit.value
            : JSON.stringify(edit.value ?? null),
        author: edit.by ?? "unknown",
        path,
        staged: cell,
      };
    });
}

const shown = (value: unknown, absent: string) =>
  value == null ? absent : typeof value === "string" ? value : JSON.stringify(value);
/** The plan's own before/after per touched id (ADR 0030 rule 8); null when the plan reports none. */
export function touchedCells(evidence: unknown): WriteCell[] | null {
  const touched = (evidence as { touched?: readonly CatalogTouch[] } | undefined)?.touched;
  if (!touched?.length) return null;
  return touched.map(({ path, before, after, by }) => ({
    key: path.join("/"),
    label: path.join(" · "),
    before: shown(before, "(none)"),
    after: shown(after, "(delete)"),
    author: by,
  }));
}

const applyKeyOf = (owner: Owner) =>
  Object.entries(catalogWorkCommands).find(
    ([, entry]) => entry.work.route === owner && entry.writeBoundary.phase === "apply",
  )![0];
const refusalOf = (row: ActionReceipt) =>
  row.state === "succeeded"
    ? null
    : {
        message:
          (row as { refusal?: { message?: string } }).refusal?.message ?? `Plan ${row.state}`,
      };

export function CatalogWorkReview({
  owner,
  at,
  target,
  client,
  reject,
}: {
  owner: Owner;
  /** The owner's Work key at this document (the route's key with `route: owner`). */
  at: WorkKey;
  target: DocumentRef;
  client: CatalogWorkClient;
  reject?: ComponentProps<typeof WriteAction>["reject"];
}) {
  const key = applyKeyOf(owner);
  const [work, setWork] = useState<{ doc: unknown; handle: WorkHandle } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ revision: number; cells: WriteCell[]; seal: WriteSeal } | null>(null);
  useEffect(() => {
    setWork(null);
    setPlan(null);
    setProblem(null);
    return client.watch(
      at,
      (value) => {
        setProblem(null);
        setWork(value);
      },
      (reason) => {
        setPlan(null);
        setProblem(reason);
      },
    );
  }, [client, at, target.session, target.openId]);
  const cells = work ? catalogWorkCells(owner, work.doc) : [];
  // The plan holds only while the Work it sealed is current; any later revision disarms it.
  const held = plan && work && plan.revision === work.handle.revision &&
    plan.seal.documentMark.session === target.session && plan.seal.documentMark.openId === target.openId
    ? plan : null;
  const admit = (id: string, k: string) =>
    client.submit({
      id: `${id}-${crypto.randomUUID()}`,
      key: k,
      target: { kind: "document", ref: target },
      input: { work: work!.handle },
    });
  const runPlan = async (): WriteRun => {
    const definition = catalogWorkCommands[key as keyof typeof catalogWorkCommands];
    const row = await admit("plan", definition.writeBoundary.previewKey);
    const refused = refusalOf(row);
    if (refused) return refused;
    const parsed = writeResponseSchema.safeParse((row as { result?: unknown }).result);
    if (!parsed.success) return { message: "Plan returned no seal" };
    const evidence = (row as { result?: { evidence?: unknown } }).result?.evidence;
    const touched = touchedCells(evidence);
    if (!touched) return { message: "The plan disclosed no touched cells" };
    setPlan({ revision: work!.handle.revision, cells: touched, seal: parsed.data.seal });
    return null;
  };
  const runApply = async (): WriteRun => {
    const refused = refusalOf(await admit("apply", key));
    setPlan(null);
    return refused;
  };
  return (
    <section data-catalog-work={owner} className="flex flex-col gap-1.5">
      <div className="t-small t-upper text-ink-mute">
        {owner} · {work ? `r${work.handle.revision}` : "unread"} · {cells.length} staged
      </div>
      {cells.map((cell) => (
        <div key={cell.key} data-catalog-cell={cell.key} className="t-small">
          <span>{cell.label}</span>{" "}
          <span data-catalog-author={cell.author}>
            <StateCell
              {...cellFromDraft(cell.staged, {
                value: cell.after,
                cap: problem ? "locked" : "editable",
                capReason: problem ?? undefined,
              })}
              scale="row"
              onCommit={async (text) => {
                try {
                  const value =
                    typeof cell.staged.edit?.value === "string" ? text : JSON.parse(text);
                  return (
                    await client.write(
                      work!.handle,
                      cellPatches(cell.path.slice(0, -1), String(cell.path.at(-1)), cell.staged, {
                        kind: "set",
                        rung: { value },
                      }),
                      cell.label,
                    )
                  )?.message;
                } catch (error) {
                  return error instanceof Error ? error.message : String(error);
                }
              }}
              transitions={[
                {
                  kind: "clear",
                  run: () =>
                    client.write(
                      work!.handle,
                      cellPatches(cell.path.slice(0, -1), String(cell.path.at(-1)), cell.staged, {
                        kind: "clear",
                      }),
                      `Clear ${cell.label}`,
                    ),
                },
              ]}
            />
          </span>
        </div>
      ))}
      <WriteAction
        label={`plan ${owner}`}
        says={`Plan ${owner} from the current Work`}
        refusal={
          problem ?? (!work ? "Read the Work first" : cells.length ? null : "Nothing staged")
        }
        held={
          held
            ? {
                word: writeWord(owner, held.cells.length, false),
                summary: `${held.cells.length} staged`,
                cells: held.cells,
              }
            : null
        }
        stale={plan && !held ? "changed since plan" : null}
        plan={runPlan}
        reject={reject}
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
